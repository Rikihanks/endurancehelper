import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDemoSession } from '../src/services/devices/racebox/demoSession.js';
import { computeTrackLaps } from '../src/services/devices/racebox/RaceBoxTrack.js';
import { sessionStats } from '../src/services/devices/racebox/RaceBoxAnalysis.js';
import { isPositionValid } from '../src/services/devices/racebox/RaceBoxTypes.js';
import { BUILTIN_TRACKS } from '../src/data/builtinTracks.js';

const TRACK = BUILTIN_TRACKS.find((t) => t.id === 'builtin:karting-canarias');

test('demo session drives the preloaded circuit and produces laps', () => {
  const records = buildDemoSession(TRACK, { laps: 3, startDate: '2026-10-19T09:00:00Z' });
  assert.ok(records, 'records are generated');
  // ~45 s per lap at 25 Hz over 3-4 laps.
  assert.ok(records.length > 2000, `records=${records.length}`);

  // Records look like real ones.
  const first = records[10];
  assert.equal(isPositionValid(first), true);
  assert.ok(first.speed > 10 && first.speed < 120, `speed=${first.speed}`);
  assert.ok(first.latitude > 28.46 && first.latitude < 28.47);
  assert.ok(first.numSVs >= 4);

  // The viewer's own timing path finds complete laps.
  const res = computeTrackLaps(records, TRACK);
  assert.ok(res.laps.length >= 2, `laps=${res.laps.length}`);
  for (const lap of res.laps) {
    assert.ok(lap.durationS > 20 && lap.durationS < 120, `duration=${lap.durationS}`);
  }

  const stats = sessionStats(records, res.laps);
  assert.ok(stats.distanceM > 800, `distance=${stats.distanceM}`);
  assert.ok(stats.maxSpeed > 20);
  assert.ok(stats.startDate instanceof Date);
});

test('demo session needs a track with a centerline', () => {
  assert.equal(buildDemoSession(null), null);
  assert.equal(buildDemoSession({ centerline: [] }), null);
  assert.equal(buildDemoSession({ centerline: [{ lat: 1, lon: 1 }] }), null);
});

test('demo session looks like real driving, not zig-zag spikes', () => {
  const records = buildDemoSession(TRACK, { laps: 3, startDate: '2026-10-19T09:00:00Z' });

  // Lateral g must stay within karting grip and never flip side to side wildly.
  let maxG = 0;
  let stepSum = 0;
  for (let i = 0; i < records.length; i++) {
    maxG = Math.max(maxG, Math.abs(records[i].gForceY));
    if (i > 0) stepSum += Math.abs(records[i].gForceY - records[i - 1].gForceY);
  }
  const meanStep = stepSum / Math.max(1, records.length - 1);
  assert.ok(maxG <= 2000, `max lateral g=${maxG} mG`);
  assert.ok(meanStep < 40, `mean lateral g step=${meanStep.toFixed(1)} mG (too spiky)`);

  // Speed: a karting trace does not stop and go every sample.
  let minSpeed = Infinity;
  let maxSpeed = 0;
  let speedStep = 0;
  for (let i = 0; i < records.length; i++) {
    minSpeed = Math.min(minSpeed, records[i].speed);
    maxSpeed = Math.max(maxSpeed, records[i].speed);
    if (i > 0) speedStep = Math.max(speedStep, Math.abs(records[i].speed - records[i - 1].speed));
  }
  assert.ok(minSpeed > 8, `min speed=${minSpeed}`);
  assert.ok(maxSpeed < 90, `max speed=${maxSpeed}`);
  assert.ok(speedStep < 3, `max speed step per sample=${speedStep.toFixed(2)} km/h`);

  // Longitudinal g stays within accelerate/brake limits.
  for (const r of records) {
    assert.ok(Math.abs(r.gForceX) <= 1000, `longitudinal g=${r.gForceX}`);
  }
});
