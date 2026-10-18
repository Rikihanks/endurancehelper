// Playback timeline helpers for the session viewer.
//
// Time-based (not distance-based) so the marker moves at the real pace, which is
// what the play/pause transport needs.

import { unwrapTime, cumulativeDistance } from './RaceBoxAnalysis.js';

export const TIMELINE_HZ = 10;

/**
 * Build a playback timeline for one lap or the whole session.
 * @param {object[]} records decoded records
 * @param {object[]} laps lap ranges (startIndex/endIndex)
 * @param {{ lapIndex?: number|null, hz?: number }} options lapIndex null = whole session
 * @returns {null | { t:number[], lat:number[], lon:number[], speed:number[], gLat:number[], gLong:number[], dist:number[], lapOf:number[] }}
 */
export function buildTimeline(records, laps, { lapIndex = null, hz = TIMELINE_HZ } = {}) {
  if (!records || records.length < 2 || !laps || !laps.length) return null;
  const t = unwrapTime(records);
  const cum = cumulativeDistance(records);
  const ranges = laps.map((l) => [l.startIndex, l.endIndex]);

  const lapOf = (i) => {
    for (let k = 0; k < ranges.length; k++) {
      if (i >= ranges[k][0] && i <= ranges[k][1]) return k;
    }
    return 0;
  };

  const lap = lapIndex == null ? null : laps[lapIndex];
  if (lapIndex != null && !lap) return null;
  const from = lap ? lap.startIndex : 0;
  const to = lap ? lap.endIndex : records.length - 1;
  const dtMs = 1000 / hz;

  const out = {
    t: [],
    lat: [],
    lon: [],
    speed: [],
    gLat: [],
    gLong: [],
    dist: [],
    lapDist: [],
    lapOf: [],
  };
  let nextT = t[from];
  for (let i = from; i <= to; i++) {
    if (t[i] >= nextT || i === from || i === to) {
      const lapIndexHere = lapOf(i);
      const lapStart = ranges[lapIndexHere] ? ranges[lapIndexHere][0] : from;
      out.t.push((t[i] - t[from]) / 1000);
      out.lat.push(records[i].latitude);
      out.lon.push(records[i].longitude);
      out.speed.push(records[i].speed || 0);
      out.gLat.push((records[i].gForceY || 0) / 1000);
      out.gLong.push((records[i].gForceX || 0) / 1000);
      out.dist.push(cum[i] - cum[from]);
      // Distance since the start of the lap the sample belongs to: the marker
      // uses it to run along the (smoothed) drawn line instead of the raw path.
      out.lapDist.push(cum[i] - cum[lapStart]);
      out.lapOf.push(lapIndexHere);
      nextT += dtMs;
    }
  }
  return out;
}

/** Index of the sample at (or just before) `seconds`, via binary search. */
export function indexAtTime(times, seconds) {
  if (!times || !times.length) return 0;
  let lo = 0;
  let hi = times.length - 1;
  if (seconds <= times[0]) return 0;
  if (seconds >= times[hi]) return hi;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= seconds) lo = mid;
    else hi = mid;
  }
  return lo;
}
