import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeTrap,
  crossedTrap,
  trapFromGateEndpoints,
  computeTrackLaps,
  computeTrackEvents,
  learnStartFinish,
  trackMatchesSession,
  suggestTrapFromCenterline,
} from '../src/services/devices/racebox/RaceBoxTrack.js';

// ~0.0009 deg lat is ~99.5 m; use small offsets helper
function offset(lat, lon, northM, eastM) {
  const mLat = 110540;
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return { lat: lat + northM / mLat, lon: lon + eastM / mLon };
}

const BASE = { lat: 28.45, lon: -16.36 };

test('crossedTrap honours direction, width and direction of travel', () => {
  const trap = makeTrap({ lat: BASE.lat, lon: BASE.lon, heading: 0, width: 100 });

  const south = offset(BASE.lat, BASE.lon, -5, 0);
  const north = offset(BASE.lat, BASE.lon, 5, 0);
  assert.equal(crossedTrap(south, north, trap), true, 'northbound crossing');
  assert.equal(crossedTrap(north, south, trap), false, 'southbound is rejected');
  assert.equal(crossedTrap(north, south, { ...trap, bidirectional: true }), true, 'bidirectional');

  // Passing well beyond the gate half-width (50 m).
  const west = offset(BASE.lat, BASE.lon, 0, -80);
  const west2 = offset(BASE.lat, BASE.lon, 0, -75);
  assert.equal(crossedTrap(west, west2, trap), false, 'outside the gate width');

  // Movement parallel to the gate never crosses it.
  const east = offset(BASE.lat, BASE.lon, 0, 20);
  const east2 = offset(BASE.lat, BASE.lon, 0, 30);
  assert.equal(crossedTrap(east, east2, trap), false);
});

test('crossedTrap works for an east-facing trap', () => {
  const trap = makeTrap({ lat: BASE.lat, lon: BASE.lon, heading: 90, width: 100 });
  const west = offset(BASE.lat, BASE.lon, 0, -5);
  const east = offset(BASE.lat, BASE.lon, 0, 5);
  assert.equal(crossedTrap(west, east, trap), true);
  assert.equal(crossedTrap(east, west, trap), false);
});

test('trapFromGateEndpoints builds a gate perpendicular to the passing direction', () => {
  const a = offset(BASE.lat, BASE.lon, 0, -25);
  const b = offset(BASE.lat, BASE.lon, 0, 25);
  const trap = trapFromGateEndpoints(a, b);
  assert.ok(Math.abs(trap.width - 50) < 0.5, `width=${trap.width}`);
  // Gate along east-west -> passing heading is ~180 (or ~0 depending on sign).
  const h = ((trap.heading % 360) + 360) % 360;
  assert.ok(Math.abs(h - 180) < 1 || Math.abs(h - 0) < 1, `heading=${h}`);
});

// Closed circuit, 25 Hz. Same generator used elsewhere.
function circleRecords({ laps = 4, pointsPerLap = 500, radiusM = 80 } = {}) {
  const records = [];
  const centerLat = BASE.lat;
  const centerLon = BASE.lon;
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const total = laps * pointsPerLap + 1;
  for (let i = 0; i < total; i++) {
    const ang = (2 * Math.PI * i) / pointsPerLap;
    records.push({
      iTOW: 1000 + i * 40,
      latitude: centerLat + (radiusM * Math.cos(ang)) / mPerLat,
      longitude: centerLon + (radiusM * Math.sin(ang)) / mPerLon,
      altitude: 100,
      speed: 90,
      heading: ((ang * 180) / Math.PI + 90) % 360,
      gForceX: 200,
      gForceY: -300,
      gForceZ: 1000,
      batteryLevel: 90,
    });
  }
  return records;
}

test('computeTrackLaps times laps exactly from a Start/Finish trap', () => {
  const records = circleRecords();
  const r0 = records[0];
  const track = {
    id: 't1',
    name: 'Circle',
    startFinish: makeTrap({ lat: r0.latitude, lon: r0.longitude, heading: r0.heading, width: 60, type: 'startFinish' }),
    splits: [],
  };
  const { laps, optimalLapS, sectorCount } = computeTrackLaps(records, track);
  assert.equal(sectorCount, 1);
  // 5 crossings (indices 500,1000,1500,2000) -> 3 complete laps (the entry lap
  // before the first crossing is not counted, like the official apps).
  assert.equal(laps.length, 3, `laps=${laps.length}`);
  for (const lap of laps) {
    assert.ok(Math.abs(lap.durationS - 20) < 0.05, `duration=${lap.durationS}`);
    assert.ok(Math.abs(lap.maxSpeed - 90) < 1e-6);
  }
  assert.ok(optimalLapS === null || Math.abs(optimalLapS - 20) < 0.05);
});

test('computeTrackEvents reports one crossing per lap', () => {
  const records = circleRecords();
  const r0 = records[0];
  const track = {
    startFinish: makeTrap({ lat: r0.latitude, lon: r0.longitude, heading: r0.heading, width: 60 }),
    splits: [],
  };
  const events = computeTrackEvents(records, track);
  assert.equal(events.length, 4);
  // Crossings are one lap (500 samples) apart.
  assert.deepEqual(events.map((e) => e.index), [500, 1000, 1500, 2000]);
});

test('learnStartFinish suggests a trap that times the laps', () => {
  const records = circleRecords();
  const trap = learnStartFinish(records);
  assert.ok(trap, 'a trap is suggested');
  assert.equal(trap.type, 'startFinish');
  const { laps } = computeTrackLaps(records, { startFinish: trap, splits: [] });
  assert.ok(laps.length >= 2, `laps=${laps.length}`);
  for (const lap of laps) assert.ok(Math.abs(lap.durationS - 20) < 0.2, `duration=${lap.durationS}`);
});

test('track laps expose every field the viewer renders', () => {
  const records = circleRecords();
  const r0 = records[0];
  const track = {
    startFinish: makeTrap({ lat: r0.latitude, lon: r0.longitude, heading: r0.heading, width: 60 }),
    splits: [],
  };
  const { laps } = computeTrackLaps(records, track);
  assert.ok(laps.length > 0, 'laps are produced');
  for (const lap of laps) {
    for (const field of [
      'durationS',
      'distanceM',
      'maxSpeed',
      'avgSpeed',
      'maxG',
      'maxLateralG',
      'maxLongitudinalG',
      'startIndex',
      'endIndex',
    ]) {
      assert.equal(typeof lap[field], 'number', `lap.${field} must be a number`);
      assert.ok(Number.isFinite(lap[field]), `lap.${field} must be finite`);
    }
  }
});

test('computeTrackLaps splits each lap with the split traps', () => {
  const records = circleRecords();
  const at = (i) => records[i];
  const track = {
    startFinish: makeTrap({
      lat: at(0).latitude,
      lon: at(0).longitude,
      heading: at(0).heading,
      width: 60,
      type: 'startFinish',
    }),
    splits: [
      makeTrap({ lat: at(125).latitude, lon: at(125).longitude, heading: at(125).heading, width: 40, type: 'split', name: 'Sector 1' }),
      makeTrap({ lat: at(375).latitude, lon: at(375).longitude, heading: at(375).heading, width: 40, type: 'split', name: 'Sector 2' }),
    ],
  };
  const { laps, sectorCount, optimalLapS } = computeTrackLaps(records, track);
  assert.equal(sectorCount, 3);
  assert.ok(laps.length >= 3, `laps=${laps.length}`);
  for (const lap of laps) {
    assert.equal(lap.sectors.length, 3);
    assert.ok(Math.abs(lap.sectors[0] - 5) < 0.2, `s1=${lap.sectors[0]}`);
    assert.ok(Math.abs(lap.sectors[1] - 10) < 0.2, `s2=${lap.sectors[1]}`);
    assert.ok(Math.abs(lap.sectors[2] - 5) < 0.2, `s3=${lap.sectors[2]}`);
    const sum = lap.sectors.reduce((a, b) => a + (b || 0), 0);
    assert.ok(Math.abs(sum - lap.durationS) < 0.2, 'sectors add up to the lap');
  }
  assert.ok(optimalLapS != null && Math.abs(optimalLapS - 20) < 0.3);
});

test('trackMatchesSession checks proximity of the session to the track', () => {
  const records = circleRecords({ laps: 1, pointsPerLap: 100 });
  const r0 = records[0];
  const near = { startFinish: makeTrap({ lat: r0.latitude, lon: r0.longitude, heading: 0 }) };
  const far = { startFinish: makeTrap({ lat: r0.latitude + 0.1, lon: r0.longitude, heading: 0 }) };
  assert.equal(trackMatchesSession(near, records), true);
  assert.equal(trackMatchesSession(far, records), false);
  assert.equal(trackMatchesSession(null, records), false);
});

test('suggestTrapFromCenterline places the line on the longest straight', () => {
  // An oval: two long straights (east/west) joined by two short ends.
  const mLat = 110540;
  const mLon = 111320 * Math.cos((BASE.lat * Math.PI) / 180);
  const P = (eastM, northM) => ({ lat: BASE.lat + northM / mLat, lon: BASE.lon + eastM / mLon });
  const centerline = [];
  // west straight going north, 200 m
  for (let n = -100; n <= 100; n += 50) centerline.push(P(-60, n));
  // north end
  centerline.push(P(-30, 130));
  centerline.push(P(0, 140));
  centerline.push(P(30, 130));
  // east straight going south, 200 m
  for (let n = 100; n >= -100; n -= 50) centerline.push(P(60, n));
  // south end
  centerline.push(P(30, -130));
  centerline.push(P(0, -140));
  centerline.push(P(-30, -130));

  const trap = suggestTrapFromCenterline(centerline, { width: 30 });
  assert.ok(trap, 'a trap is suggested');
  assert.equal(trap.type, 'startFinish');
  assert.equal(trap.bidirectional, true);
  // The line should land on a long straight, i.e. near x = -60 or x = +60 m.
  const x = (trap.lon - BASE.lon) * mLon;
  assert.ok(Math.abs(Math.abs(x) - 60) < 12, `x=${x}`);
});

test('suggestTrapFromCenterline returns null for a tiny path', () => {
  assert.equal(suggestTrapFromCenterline([], {}), null);
  assert.equal(suggestTrapFromCenterline([{ lat: 1, lon: 1 }, { lat: 1.001, lon: 1 }], {}), null);
});
