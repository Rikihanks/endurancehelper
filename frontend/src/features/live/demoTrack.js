import { makeTrap } from '../../services/devices/racebox/RaceBoxTrack.js';
import { buildDemoSession } from '../../services/devices/racebox/demoSession.js';
import { BUILTIN_TRACKS } from '../../data/builtinTracks.js';

export function splitAt(centerline, ratio, width = 40) {
  const index = Math.min(centerline.length - 2, Math.max(1, Math.round(centerline.length * ratio)));
  const a = centerline[index - 1];
  const b = centerline[Math.min(index + 1, centerline.length - 1)];
  const metersPerLon = 111320 * Math.cos((a.lat * Math.PI) / 180);
  const dx = (b.lon - a.lon) * metersPerLon;
  const dy = (b.lat - a.lat) * 110540;
  const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return makeTrap({
    lat: centerline[index].lat,
    lon: centerline[index].lon,
    heading,
    width,
    type: 'split',
    name: `S${Math.round(ratio * 100)}`,
  });
}

export function buildSimulation({ track = null, laps = 3, hz = 25 } = {}) {
  const builtin = BUILTIN_TRACKS.find((candidate) => Array.isArray(candidate.centerline)) || null;
  const provided = track && Array.isArray(track.centerline) && track.centerline.length >= 4 && track.startFinish && track.builtin
    ? track
    : null;
  const base = provided || builtin;
  if (!base) return null;

  const simTrack = base.splits && base.splits.length
    ? base
    : { ...base, splits: [splitAt(base.centerline, 1 / 3), splitAt(base.centerline, 2 / 3)] };

  const records = buildDemoSession(simTrack, { laps, hz });
  if (!records || !records.length) return null;
  return { track: simTrack, records };
}
