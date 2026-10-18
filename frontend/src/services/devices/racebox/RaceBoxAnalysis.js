// RaceBox session analysis: pure functions over decoded records.
//
// A "record" is one decoded 0xFF/0x01 or 0xFF/0x21 payload (see RaceBoxTypes).
// Everything here is dependency-free and deterministic, so it can be unit
// tested without Bluetooth or a device.
//
// Lap detection is heuristic (we have no track database like the official app):
// we look for the tightest self-approach of the path (a closed circuit crosses
// itself once per lap at the start/finish) and then count the returns to that
// point with a consistent heading. Sessions that never close (point-to-point)
// yield a single lap.

const EARTH_R = 6371000;
const MIN_LAP_DISTANCE_M = 120;
const MAX_LAP_DISTANCE_M = 6000;
const MIN_LAP_TIME_S = 12;
const START_RADIUS_M = 25;
const HEADING_TOLERANCE_DEG = 55;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres between two lat/lon points. */
export function haversine(aLat, aLon, bLat, bLon) {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const la1 = toRad(aLat);
  const la2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function headingDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Monotonic time axis in ms derived from iTOW (GPS time of week), handling the
 * weekly rollover so lap durations stay correct across a week boundary.
 * @param {import('./RaceBoxTypes.js').RaceBoxRecord[]} records
 * @returns {number[]}
 */
export function unwrapTime(records) {
  const WEEK = 7 * 24 * 3600 * 1000;
  const out = new Array(records.length);
  let prev = null;
  let offset = 0;
  for (let i = 0; i < records.length; i++) {
    const itow = records[i].iTOW >>> 0;
    if (prev !== null && itow + offset < prev - WEEK / 2) {
      offset += WEEK; // forward rollover
    }
    const t = itow + offset;
    out[i] = t;
    prev = t;
  }
  const base = out.length ? out[0] : 0;
  for (let i = 0; i < out.length; i++) out[i] -= base;
  return out;
}

/** Cumulative distance (m) along the path, index i = distance from point 0. */
export function cumulativeDistance(records) {
  const out = new Array(records.length);
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < records.length; i++) {
    acc += haversine(
      records[i - 1].latitude,
      records[i - 1].longitude,
      records[i].latitude,
      records[i].longitude,
    );
    out[i] = acc;
  }
  return out;
}

/**
 * Find the tightest self-approach of the path, used as the start/finish
 * candidate. Uses a spatial grid so it stays fast on 100k+ points.
 * @returns {number} index of the candidate, or -1
 */
function findStartCandidate(records, cum, step = 2) {
  const cell = 25; // metres
  const grid = new Map();
  const key = (lat, lon) => {
    const x = Math.round((lon * 111320 * Math.cos(toRad(lat))) / cell);
    const y = Math.round((lat * 110540) / cell);
    return `${x},${y}`;
  };
  for (let i = 0; i < records.length; i += step) {
    const k = key(records[i].latitude, records[i].longitude);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }

  let best = -1;
  let bestDist = START_RADIUS_M;
  for (let i = step; i < records.length - step; i += step) {
    const r = records[i];
    const x = Math.round((r.longitude * 111320 * Math.cos(toRad(r.latitude))) / cell);
    const y = Math.round((r.latitude * 110540) / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${x + dx},${y + dy}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const gap = cum[j] - cum[i];
          if (gap < MIN_LAP_DISTANCE_M || gap > MAX_LAP_DISTANCE_M) continue;
          const d = haversine(
            r.latitude,
            r.longitude,
            records[j].latitude,
            records[j].longitude,
          );
          if (d < bestDist && headingDiff(r.heading, records[j].heading) < HEADING_TOLERANCE_DEG) {
            bestDist = d;
            best = i;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Suggest a Start/Finish index from the tightest self-approach of the path.
 * Used only to bootstrap a new track; a stored track uses explicit traps instead.
 * @returns {number} index, or -1
 */
export function suggestStartIndex(records) {
  if (!records || records.length < 10) return -1;
  const cum = cumulativeDistance(records);
  return findStartCandidate(records, cum);
}

/**
 * Detect laps. Returns an array of laps:
 *   { startIndex, endIndex, startMs, endMs, durationS, distanceM, maxSpeed, avgSpeed, maxLateralG, maxLongitudinalG, maxG }
 * @param {import('./RaceBoxTypes.js').RaceBoxRecord[]} records
 * @param {{ startIndex?: number }} [options]
 */
export function detectLaps(records, options = {}) {
  if (!records || records.length < 2) return [];
  const t = unwrapTime(records);
  const cum = cumulativeDistance(records);

  let start = options.startIndex;
  if (start == null) {
    const candidate = findStartCandidate(records, cum);
    start = candidate >= 0 ? candidate : -1;
  }

  const boundaries = [];
  if (start >= 0 && start < records.length - 1) {
    boundaries.push(start);
    let last = start;
    for (let i = start + 1; i < records.length; i++) {
      const gap = cum[i] - cum[last];
      if (gap < MIN_LAP_DISTANCE_M) continue;
      if (gap > MAX_LAP_DISTANCE_M) break; // lap too long: stop, avoid false positives

      // Closest approach to the last boundary point = the real line crossing.
      let minD = Infinity;
      let minI = -1;
      for (let k = i; k < records.length; k++) {
        const g = cum[k] - cum[last];
        if (g > MAX_LAP_DISTANCE_M) break;
        if (g < MIN_LAP_DISTANCE_M) continue;
        const d = haversine(
          records[last].latitude,
          records[last].longitude,
          records[k].latitude,
          records[k].longitude,
        );
        if (d < minD) {
          minD = d;
          minI = k;
        }
      }

      if (minI < 0) break;
      const dt = (t[minI] - t[last]) / 1000;
      if (
        minD <= START_RADIUS_M &&
        dt >= MIN_LAP_TIME_S &&
        headingDiff(records[last].heading, records[minI].heading) < HEADING_TOLERANCE_DEG
      ) {
        boundaries.push(minI);
        last = minI;
        i = minI; // continue scanning after the crossing
      } else {
        break;
      }
    }
  }

  const laps = [];
  for (let b = 0; b < boundaries.length - 1; b++) {
    const s = boundaries[b];
    const e = boundaries[b + 1];
    laps.push(summarizeLap(records, t, cum, s, e));
  }
  // A partial opening lap (before the first boundary) is kept as an entry
  // segment only when no full lap was found, so the viewer always has data.
  if (laps.length === 0 && records.length > 1) {
    laps.push(summarizeLap(records, t, cum, 0, records.length - 1));
  }
  return laps;
}

function summarizeLap(records, t, cum, s, e) {
  let maxSpeed = 0;
  let speedSum = 0;
  let maxG = 0;
  let maxLat = 0;
  let maxLong = 0;
  for (let i = s; i <= e; i++) {
    const sp = records[i].speed || 0;
    if (sp > maxSpeed) maxSpeed = sp;
    speedSum += sp;
    const gx = Math.abs(records[i].gForceX || 0);
    const gy = Math.abs(records[i].gForceY || 0);
    if (gx > maxLong) maxLong = gx;
    if (gy > maxLat) maxLat = gy;
    if (gx > maxG) maxG = gx;
    if (gy > maxG) maxG = gy;
  }
  const n = e - s + 1;
  return {
    startIndex: s,
    endIndex: e,
    startMs: t[s],
    endMs: t[e],
    durationS: (t[e] - t[s]) / 1000,
    distanceM: cum[e] - cum[s],
    maxSpeed,
    avgSpeed: n ? speedSum / n : 0,
    maxLateralG: maxLat,
    maxLongitudinalG: maxLong,
    maxG,
  };
}

/** Session-level summary. */
export function sessionStats(records, laps) {
  const t = unwrapTime(records);
  const cum = cumulativeDistance(records);
  let maxSpeed = 0;
  let maxG = 0;
  for (const r of records) {
    if ((r.speed || 0) > maxSpeed) maxSpeed = r.speed;
    const g = Math.max(Math.abs(r.gForceX || 0), Math.abs(r.gForceY || 0));
    if (g > maxG) maxG = g;
  }
  const bestLap = laps && laps.length
    ? laps.reduce((a, b) => (b.durationS < a.durationS ? b : a))
    : null;
  return {
    recordCount: records.length,
    durationS: records.length ? (t[records.length - 1] - t[0]) / 1000 : 0,
    distanceM: cum.length ? cum[cum.length - 1] : 0,
    maxSpeed,
    maxG,
    lapCount: laps ? laps.length : 0,
    bestLap,
    startDate: dateFromRecord(records[0]),
  };
}

/** Best effort absolute UTC date from a record (null when time is not valid). */
export function dateFromRecord(r) {
  if (!r || !r.year) return null;
  const d = new Date(
    Date.UTC(r.year, (r.month || 1) - 1, r.day || 1, r.hour || 0, r.minute || 0, r.second || 0),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resample a lap onto a uniform distance grid (m) for lap comparison.
 * @param {import('./RaceBoxTypes.js').RaceBoxRecord[]} records
 * @param {ReturnType<typeof summarizeLap>} lap
 * @param {number} stepM
 */
export function resampleLapByDistance(records, lap, stepM = 5) {
  const t = unwrapTime(records);
  const cum = cumulativeDistance(records);
  const d0 = cum[lap.startIndex];
  const distances = [];
  const times = [];
  const speeds = [];
  const lat = [];
  const lon = [];
  const gLat = [];
  const gLong = [];
  const ele = [];
  let j = lap.startIndex;
  const total = lap.distanceM;
  for (let d = 0; d <= total; d += stepM) {
    const target = d0 + d;
    while (j < lap.endIndex && cum[j + 1] < target) j++;
    const a = j;
    const b = Math.min(j + 1, lap.endIndex);
    const seg = cum[b] - cum[a] || 1;
    const f = Math.min(1, Math.max(0, (target - cum[a]) / seg));
    const lerp = (x, y) => x + (y - x) * f;
    distances.push(d);
    times.push((t[a] + (t[b] - t[a]) * f - t[lap.startIndex]) / 1000);
    speeds.push(lerp(records[a].speed, records[b].speed));
    lat.push(lerp(records[a].latitude, records[b].latitude));
    lon.push(lerp(records[a].longitude, records[b].longitude));
    gLat.push(lerp(records[a].gForceY || 0, records[b].gForceY || 0));
    gLong.push(lerp(records[a].gForceX || 0, records[b].gForceX || 0));
    ele.push(lerp(records[a].altitude || 0, records[b].altitude || 0));
  }
  return { distances, times, speeds, lat, lon, gLat, gLong, ele };
}

/**
 * Time delta (s) of each lap against a reference lap, on a distance grid.
 * Positive = behind the reference at that point.
 */
export function computeDeltas(records, laps, referenceLap, stepM = 5) {
  const ref = resampleLapByDistance(records, referenceLap, stepM);
  return laps.map((lap) => {
    const grid = resampleLapByDistance(records, lap, stepM);
    const n = Math.min(ref.distances.length, grid.distances.length);
    const delta = new Array(n);
    for (let i = 0; i < n; i++) delta[i] = grid.times[i] - ref.times[i];
    return { lap, distances: grid.distances.slice(0, n), delta };
  });
}

/** Downsample an array of points to at most `max` entries, keeping first/last. */
export function downsample(items, max = 1500) {
  if (!items || items.length <= max) return items || [];
  const stride = Math.ceil(items.length / max);
  const out = [];
  for (let i = 0; i < items.length; i += stride) out.push(items[i]);
  if (out[out.length - 1] !== items[items.length - 1]) out.push(items[items.length - 1]);
  return out;
}

/** Format seconds as m:ss.mmm */
export function formatLapTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// ── Exports ──────────────────────────────────────────────────────────────────

/** GPX 1.1 with one track segment per session. */
export function toGpx(records, meta = {}) {
  const name = (meta.name || 'InLap RaceBox session').replace(/[<>&]/g, '');
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="InLap" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <trk><name>${name}</name><trkseg>`,
  ];
  for (const r of records) {
    if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
    parts.push(
      `    <trkpt lat="${r.latitude.toFixed(7)}" lon="${r.longitude.toFixed(7)}"><ele>${(
        r.altitude || 0
      ).toFixed(2)}</ele></trkpt>`,
    );
  }
  parts.push('  </trkseg></trk>', '</gpx>');
  return parts.join('\n');
}

/** CSV similar to the RaceBox export columns. */
export function toCsv(records) {
  const header =
    'Time,iTOW,Latitude,Longitude,Altitude,Speed,Heading,GForceX,GForceY,GForceZ,RotRateX,RotRateY,RotRateZ,Battery';
  const rows = records.map((r) => {
    const time = r.year
      ? `${r.year}-${pad2(r.month)}-${pad2(r.day)} ${pad2(r.hour)}:${pad2(r.minute)}:${pad2(r.second)}.000`
      : '';
    return [
      time,
      r.iTOW,
      r.latitude,
      r.longitude,
      r.altitude.toFixed(2),
      r.speed.toFixed(2),
      r.heading.toFixed(1),
      r.gForceX,
      r.gForceY,
      r.gForceZ,
      r.rotRateX,
      r.rotRateY,
      r.rotRateZ,
      r.batteryLevel,
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
