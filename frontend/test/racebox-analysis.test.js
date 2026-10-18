import test from 'node:test';
import assert from 'node:assert/strict';

import {
  haversine,
  unwrapTime,
  cumulativeDistance,
  detectLaps,
  sessionStats,
  resampleLapByDistance,
  computeDeltas,
  downsample,
  formatLapTime,
  toGpx,
  toCsv,
  dateFromRecord,
} from '../src/services/devices/racebox/RaceBoxAnalysis.js';

// Synthetic closed circuit: a circle of radius R around a center, driven at a
// constant 25 Hz. Deterministic, no device needed.
function circleRecords({ laps = 4, pointsPerLap = 500, radiusM = 80, centerLat = 28.45, centerLon = -16.36 }) {
  const records = [];
  const itow0 = 100000;
  const dtMs = 40; // 25 Hz
  const total = laps * pointsPerLap + 1;
  const mPerDegLat = 110540;
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  for (let i = 0; i < total; i++) {
    const ang = (2 * Math.PI * i) / pointsPerLap;
    const lat = centerLat + (radiusM * Math.cos(ang)) / mPerDegLat;
    const lon = centerLon + (radiusM * Math.sin(ang)) / mPerDegLon;
    // Heading tangent to the circle (clockwise in this parametrisation).
    const heading = ((ang * 180) / Math.PI + 90) % 360;
    records.push({
      iTOW: itow0 + i * dtMs,
      year: 2026,
      month: 10,
      day: 18,
      hour: 10,
      minute: 0,
      second: 0,
      latitude: lat,
      longitude: lon,
      altitude: 100,
      speed: 90, // km/h
      heading,
      gForceX: 200,
      gForceY: -300,
      gForceZ: 1000,
      rotRateX: 0,
      rotRateY: 0,
      rotRateZ: 100,
      batteryLevel: 90,
      charging: false,
    });
  }
  return records;
}

test('haversine measures known distances', () => {
  // ~111.19 m per 0.001 deg of latitude
  const d = haversine(28.45, -16.36, 28.451, -16.36);
  assert.ok(Math.abs(d - 111.19) < 0.5, `d=${d}`);
});

test('unwrapTime handles the weekly iTOW rollover', () => {
  const WEEK = 7 * 24 * 3600 * 1000;
  const records = [{ iTOW: WEEK - 1000 }, { iTOW: WEEK - 500 }, { iTOW: 100 }, { iTOW: 600 }];
  const t = unwrapTime(records);
  assert.deepEqual(t, [0, 500, 1100, 1600]);
});

test('cumulativeDistance adds up segment lengths', () => {
  const records = circleRecords({ laps: 1, pointsPerLap: 100, radiusM: 80 });
  const cum = cumulativeDistance(records);
  assert.equal(cum[0], 0);
  // A full circle of radius 80 m is ~502.65 m.
  assert.ok(Math.abs(cum[cum.length - 1] - 2 * Math.PI * 80) < 6, `total=${cum[cum.length - 1]}`);
});

test('detectLaps finds the laps on a closed circuit (explicit start)', () => {
  const records = circleRecords({ laps: 4, pointsPerLap: 500 });
  const laps = detectLaps(records, { startIndex: 0 });
  assert.equal(laps.length, 4);
  for (const lap of laps) {
    assert.ok(Math.abs(lap.durationS - 20) < 0.1, `duration=${lap.durationS}`);
    assert.ok(Math.abs(lap.distanceM - 2 * Math.PI * 80) < 6, `dist=${lap.distanceM}`);
    assert.ok(Math.abs(lap.maxSpeed - 90) < 1e-6);
  }
});

test('detectLaps auto-detects the start/finish without a hint', () => {
  const records = circleRecords({ laps: 4, pointsPerLap: 500 });
  const laps = detectLaps(records);
  assert.ok(laps.length >= 2, `laps=${laps.length}`);
  for (const lap of laps) {
    assert.ok(Math.abs(lap.durationS - 20) < 0.2, `duration=${lap.durationS}`);
  }
});

test('detectLaps falls back to a single segment when the path never closes', () => {
  const records = circleRecords({ laps: 1, pointsPerLap: 80 }).slice(0, 30);
  const laps = detectLaps(records);
  assert.equal(laps.length, 1);
  assert.equal(laps[0].startIndex, 0);
});

test('sessionStats summarizes laps and picks the best', () => {
  const records = circleRecords({ laps: 4, pointsPerLap: 500 });
  const laps = detectLaps(records, { startIndex: 0 });
  const stats = sessionStats(records, laps);
  assert.equal(stats.recordCount, records.length);
  assert.equal(stats.lapCount, 4);
  assert.ok(Math.abs(stats.maxSpeed - 90) < 1e-6);
  assert.ok(Math.abs(stats.maxG - 300) < 1e-6);
  assert.ok(stats.bestLap);
  assert.ok(stats.startDate instanceof Date);
});

test('resampleLapByDistance builds a uniform grid', () => {
  const records = circleRecords({ laps: 2, pointsPerLap: 500 });
  const laps = detectLaps(records, { startIndex: 0 });
  const grid = resampleLapByDistance(records, laps[0], 10);
  assert.ok(grid.distances.length > 40 && grid.distances.length < 60);
  assert.equal(grid.distances[0], 0);
  assert.ok(grid.distances[1] - grid.distances[0] === 10);
});

test('computeDeltas is ~zero for identical laps', () => {
  const records = circleRecords({ laps: 3, pointsPerLap: 500 });
  const laps = detectLaps(records, { startIndex: 0 });
  const deltas = computeDeltas(records, laps, laps[0]);
  assert.equal(deltas.length, laps.length);
  for (const d of deltas) {
    for (const v of d.delta) assert.ok(Math.abs(v) < 0.05, `delta=${v}`);
  }
});

test('downsample bounds the number of points', () => {
  const arr = Array.from({ length: 5000 }, (_, i) => i);
  const out = downsample(arr, 1000);
  assert.ok(out.length <= 1001);
  assert.equal(out[0], 0);
  assert.equal(out[out.length - 1], 4999);
});

test('formatLapTime formats minutes, seconds and millis', () => {
  assert.equal(formatLapTime(20), '0:20.000');
  assert.equal(formatLapTime(83.456), '1:23.456');
  assert.equal(formatLapTime(null), '—');
});

test('toGpx and toCsv produce valid exports', () => {
  const records = circleRecords({ laps: 1, pointsPerLap: 50 });
  const gpx = toGpx(records, { name: 'Test session' });
  assert.match(gpx, /<gpx version="1.1"/);
  assert.equal((gpx.match(/<trkpt/g) || []).length, records.length);
  assert.match(gpx, /<\/gpx>/);

  const csv = toCsv(records);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, records.length + 1);
  assert.match(lines[0], /^Time,iTOW,Latitude,Longitude/);
  assert.equal(lines[1].split(',').length, 14);
});

test('dateFromRecord returns null without a valid date', () => {
  assert.equal(dateFromRecord({ year: 0 }), null);
  const d = dateFromRecord({ year: 2026, month: 10, day: 18, hour: 17, minute: 27, second: 0 });
  assert.equal(d.toISOString(), '2026-10-18T17:27:00.000Z');
});
