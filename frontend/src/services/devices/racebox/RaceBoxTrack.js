// Track definitions and trap-based lap timing.
//
// Mirrors how RaceChrono/RaceBox time laps: a track is a set of "traps" (gates),
// each with a position, a passing heading and a width. A lap starts and ends when
// the vehicle crosses the Start/Finish trap; the traps in between are sectors.
// This replaces the heuristic self-approach detection once a track is known.
//
// Everything here is pure and dependency-free (unit tested without a device).

import { unwrapTime, suggestStartIndex } from './RaceBoxAnalysis.js';

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

export const DEFAULT_TRAP_WIDTH_M = 50;
const MIN_LAP_TIME_S = 8;
const TRAP_DEBOUNCE_MS = 1200;

function metersPerDegLon(lat) {
  return M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180);
}

/**
 * Build a trap from a centre, a passing heading (degrees, direction of travel)
 * and a width in metres.
 * @param {{lat:number, lon:number, heading:number, width?:number, bidirectional?:boolean, type?:string, name?:string}} spec
 */
export function makeTrap({
  lat,
  lon,
  heading = 0,
  width = DEFAULT_TRAP_WIDTH_M,
  bidirectional = false,
  type = 'split',
  name = null,
}) {
  return {
    lat,
    lon,
    heading: ((heading % 360) + 360) % 360,
    width,
    bidirectional,
    type, // 'startFinish' | 'split'
    name,
  };
}

/**
 * Derive a trap from two GPS points (the gate endpoints). Used by the editor:
 * the heading is perpendicular to the gate line.
 */
export function trapFromGateEndpoints(a, b, { type = 'split', name = null } = {}) {
  const lat = (a.lat + b.lat) / 2;
  const lon = (a.lon + b.lon) / 2;
  const x = (b.lon - a.lon) * metersPerDegLon(lat);
  const y = (b.lat - a.lat) * M_PER_DEG_LAT;
  const gateHeading = (Math.atan2(x, y) * 180) / Math.PI; // gate line bearing
  const width = Math.hypot(x, y);
  return makeTrap({ lat, lon, heading: gateHeading + 90, width, type, name });
}

function toLocal(p, trap) {
  const mLon = metersPerDegLon(trap.lat);
  const lon = p.lon != null ? p.lon : p.longitude;
  const lat = p.lat != null ? p.lat : p.latitude;
  return {
    x: (lon - trap.lon) * mLon,
    y: (lat - trap.lat) * M_PER_DEG_LAT,
  };
}

/**
 * Did the movement prev -> curr cross the trap in the correct direction?
 *
 * Uses the sign change of the signed distance to the gate plane, which is robust
 * when a GPS sample lands exactly on the line (common at 25 Hz). The lateral
 * position at the crossing must fall inside the gate width.
 * @param {{lat:number, lon:number}} prev
 * @param {{lat:number, lon:number}} curr
 * @param {ReturnType<typeof makeTrap>} trap
 */
export function crossedTrap(prev, curr, trap) {
  const a = toLocal(prev, trap);
  const b = toLocal(curr, trap);
  const hx = Math.sin((trap.heading * Math.PI) / 180);
  const hy = Math.cos((trap.heading * Math.PI) / 180);
  const dA = a.x * hx + a.y * hy;
  const dB = b.x * hx + b.y * hy;

  const forward = dA < 0 && dB >= 0;
  const backward = dA > 0 && dB <= 0;
  if (!forward && !backward) return false;
  if (backward && !trap.bidirectional) return false;

  // Lateral offset (along the gate line) at the crossing point.
  const gateAngle = ((180 - trap.heading) * Math.PI) / 180;
  const gx = Math.cos(gateAngle);
  const gy = Math.sin(gateAngle);
  const denom = dA - dB;
  const s = Math.abs(denom) < 1e-12 ? 0.5 : dA / denom;
  const cx = a.x + (b.x - a.x) * s;
  const cy = a.y + (b.y - a.y) * s;
  const lateral = cx * gx + cy * gy;
  return Math.abs(lateral) <= trap.width / 2 + 1e-3;
}

/**
 * Find every trap crossing in a session (in time order).
 * @returns {{ trapIndex: number, index: number, ms: number }[]}
 */
export function computeTrackEvents(records, track) {
  const traps = [track.startFinish, ...(track.splits || [])].filter(Boolean);
  if (!traps.length || !records || records.length < 2) return [];
  const t = unwrapTime(records);
  const events = [];
  const lastMs = new Array(traps.length).fill(-Infinity);
  for (let i = 1; i < records.length; i++) {
    for (let k = 0; k < traps.length; k++) {
      if (t[i] - lastMs[k] < TRAP_DEBOUNCE_MS) continue;
      if (crossedTrap(records[i - 1], records[i], traps[k])) {
        lastMs[k] = t[i];
        events.push({ trapIndex: k, index: i, ms: t[i] });
      }
    }
  }
  events.sort((a, b) => a.ms - b.ms);
  return events;
}

/**
 * Lap and sector timing from a known track.
 * @returns {{ laps: object[], sectorCount: number, optimalLapS: number|null }}
 */
export function computeTrackLaps(records, track) {
  const events = computeTrackEvents(records, track);
  const splitCount = (track.splits || []).length;
  const sectorCount = splitCount + 1;
  const lapEvents = events.filter((e) => e.trapIndex === 0);

  const laps = [];
  for (let b = 0; b + 1 < lapEvents.length; b++) {
    const s = lapEvents[b];
    const e = lapEvents[b + 1];
    const durationS = (e.ms - s.ms) / 1000;
    if (durationS < MIN_LAP_TIME_S) continue;

    const sectors = [];
    let prevMs = s.ms;
    for (let k = 1; k <= splitCount; k++) {
      const ev = events.find((x) => x.trapIndex === k && x.ms > prevMs && x.ms < e.ms);
      if (ev) {
        sectors.push((ev.ms - prevMs) / 1000);
        prevMs = ev.ms;
      } else {
        sectors.push(null);
      }
    }
    sectors.push((e.ms - prevMs) / 1000);

    let maxSpeed = 0;
    let maxG = 0;
    for (let i = s.index; i <= e.index; i++) {
      const rec = records[i];
      if (rec.speed > maxSpeed) maxSpeed = rec.speed;
      const g = Math.max(Math.abs(rec.gForceX || 0), Math.abs(rec.gForceY || 0));
      if (g > maxG) maxG = g;
    }

    laps.push({
      startIndex: s.index,
      endIndex: e.index,
      startMs: s.ms,
      endMs: e.ms,
      durationS,
      sectors,
      distanceM: lapDistanceM(records, { startIndex: s.index, endIndex: e.index }),
      maxSpeed,
      maxG,
    });
  }

  let optimalLapS = null;
  if (laps.length >= 2) {
    const best = new Array(sectorCount).fill(Infinity);
    for (const lap of laps) {
      lap.sectors.forEach((sec, i) => {
        if (sec != null && sec < best[i]) best[i] = sec;
      });
    }
    if (best.every((v) => Number.isFinite(v))) {
      optimalLapS = best.reduce((a, b) => a + b, 0);
    }
  }

  return { laps, sectorCount, optimalLapS };
}

/**
 * Suggest a Start/Finish trap from a recorded session: the tightest self-approach
 * of the path (the line the car crosses every lap). Used to learn a new track.
 * @returns {ReturnType<typeof makeTrap>|null}
 */
export function learnStartFinish(records, { width = DEFAULT_TRAP_WIDTH_M } = {}) {
  if (!records || records.length < 10) return null;
  const index = suggestStartIndex(records);
  if (index < 0) return null;
  const r = records[index];
  return makeTrap({
    lat: r.latitude,
    lon: r.longitude,
    heading: r.heading || 0,
    width,
    type: 'startFinish',
    name: 'Meta',
  });
}

/**
 * Whether a track is plausibly the one a session was driven on (used to attach
 * a saved track to a newly downloaded session automatically).
 */
export function trackMatchesSession(track, records, toleranceM = 500) {
  if (!track || !records || !records.length) return false;
  const lat = records[0].latitude;
  const lon = records[0].longitude;
  const x = (lon - track.startFinish.lon) * metersPerDegLon(track.startFinish.lat);
  const y = (lat - track.startFinish.lat) * M_PER_DEG_LAT;
  return Math.hypot(x, y) <= toleranceM;
}

/** Compute the lap timing distance of a lap (used when sectors are missing). */
export function lapDistanceM(records, lap) {
  let d = 0;
  for (let i = lap.startIndex + 1; i <= lap.endIndex; i++) {
    const a = records[i - 1];
    const b = records[i];
    const x = (b.longitude - a.longitude) * metersPerDegLon(a.latitude);
    const y = (b.latitude - a.latitude) * M_PER_DEG_LAT;
    d += Math.hypot(x, y);
  }
  return d;
}

// Re-export the heuristic used only to bootstrap a new track.
export { suggestStartIndex };
