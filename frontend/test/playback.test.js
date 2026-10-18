import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTimeline, indexAtTime, TIMELINE_HZ } from '../src/services/devices/racebox/playback.js';

function records({ laps = 3, pointsPerLap = 200, lapSeconds = 20 } = {}) {
  const out = [];
  const hz = pointsPerLap / lapSeconds; // samples per second
  const dt = 1000 / hz;
  const total = laps * pointsPerLap;
  for (let i = 0; i < total; i++) {
    out.push({
      iTOW: Math.round(i * dt),
      latitude: 28.46 + (i % pointsPerLap) * 1e-6,
      longitude: -16.35,
      speed: 40 + (i % 20),
      gForceX: 100,
      gForceY: -200,
    });
  }
  return out;
}

const LAPS = [
  { startIndex: 0, endIndex: 199 },
  { startIndex: 200, endIndex: 399 },
  { startIndex: 400, endIndex: 599 },
];

test('buildTimeline for one lap is monotonic and ~lap length', () => {
  const recs = records();
  const tl = buildTimeline(recs, LAPS, { lapIndex: 1 });
  assert.ok(tl);
  assert.ok(tl.t.length > 10);
  assert.equal(tl.t[0], 0);
  for (let i = 1; i < tl.t.length; i++) {
    assert.ok(tl.t[i] >= tl.t[i - 1], `t must be monotonic (i=${i})`);
  }
  const duration = tl.t[tl.t.length - 1];
  assert.ok(Math.abs(duration - 20) < 1, `duration=${duration}`);
  assert.ok(tl.lapOf.every((l) => l === 1));
  assert.ok(tl.dist[tl.dist.length - 1] > 10);
});

test('buildTimeline for the whole session covers every lap', () => {
  const recs = records();
  const tl = buildTimeline(recs, LAPS, { lapIndex: null });
  assert.ok(tl);
  const duration = tl.t[tl.t.length - 1];
  assert.ok(Math.abs(duration - 60) < 1.5, `duration=${duration}`);
  const lapSet = new Set(tl.lapOf);
  assert.deepEqual([...lapSet].sort(), [0, 1, 2]);
  // Samples every ~1/10 s.
  assert.ok(tl.t.length > 500 && tl.t.length < 700, `samples=${tl.t.length}`);
});

test('buildTimeline returns null without records/laps', () => {
  assert.equal(buildTimeline(null, LAPS), null);
  assert.equal(buildTimeline(records(), []), null);
  assert.equal(buildTimeline(records(), LAPS, { lapIndex: 9 }), null);
});

test('indexAtTime finds the right sample', () => {
  const times = [0, 1, 2, 3, 4, 5];
  assert.equal(indexAtTime(times, -1), 0);
  assert.equal(indexAtTime(times, 0), 0);
  assert.equal(indexAtTime(times, 2.4), 2);
  assert.equal(indexAtTime(times, 2.6), 2);
  assert.equal(indexAtTime(times, 5), 5);
  assert.equal(indexAtTime(times, 99), 5);
  assert.equal(indexAtTime([], 3), 0);
  assert.equal(indexAtTime(null, 3), 0);
});

test('TIMELINE_HZ is a sane sampling rate', () => {
  assert.ok(TIMELINE_HZ >= 5 && TIMELINE_HZ <= 25);
});
