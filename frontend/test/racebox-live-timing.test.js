import test from 'node:test';
import assert from 'node:assert/strict';

import { LiveTiming } from '../src/services/devices/racebox/RaceBoxLiveTiming.js';
import { makeTrap } from '../src/services/devices/racebox/RaceBoxTrack.js';

const BASE = { lat: 28.45, lon: -16.36 };

function circleRecords({ laps = 4, pointsPerLap = 500, radiusM = 80 } = {}) {
  const records = [];
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos((BASE.lat * Math.PI) / 180);
  const total = laps * pointsPerLap + 1;
  for (let i = 0; i < total; i++) {
    const ang = (2 * Math.PI * i) / pointsPerLap;
    records.push({
      iTOW: 1000 + i * 40,
      latitude: BASE.lat + (radiusM * Math.cos(ang)) / mPerLat,
      longitude: BASE.lon + (radiusM * Math.sin(ang)) / mPerLon,
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

function trackWithSplits(records) {
  const at = (idx) => records[idx];
  return {
    id: 't1',
    name: 'Karting test',
    startFinish: makeTrap({ lat: at(0).latitude, lon: at(0).longitude, heading: at(0).heading, width: 60, type: 'startFinish' }),
    splits: [
      makeTrap({ lat: at(125).latitude, lon: at(125).longitude, heading: at(125).heading, width: 40, type: 'split', name: 'S1' }),
      makeTrap({ lat: at(375).latitude, lon: at(375).longitude, heading: at(375).heading, width: 40, type: 'split', name: 'S2' }),
    ],
  };
}

test('LiveTiming times laps and sectors from the live stream', () => {
  const records = circleRecords();
  const engine = new LiveTiming(trackWithSplits(records));
  const events = [];
  for (const r of records) {
    const ev = engine.push(r);
    if (ev) events.push(ev);
  }

  const types = events.map((e) => e.type);
  assert.equal(types[0], 'start', 'first Start/Finish crossing starts the timer');
  assert.equal(types.filter((t) => t === 'lap').length, 3, '3 completed laps');
  assert.equal(types.filter((t) => t === 'sector').length, 6, '2 splits x 3 laps');
  assert.ok(events.some((e) => e.type === 'sector' && e.index === 0));

  assert.equal(engine.laps.length, 3);
  for (const lap of engine.laps) {
    assert.ok(Math.abs(lap.durationS - 20) < 0.05, `lap=${lap.durationS}`);
    assert.equal(lap.sectors.length, 3);
    assert.ok(Math.abs(lap.sectors[0] - 5) < 0.05, `s0=${lap.sectors[0]}`);
    assert.ok(Math.abs(lap.sectors[1] - 10) < 0.05, `s1=${lap.sectors[1]}`);
    assert.ok(Math.abs(lap.sectors[2] - 5) < 0.05, `s2=${lap.sectors[2]}`);
  }
  assert.ok(Math.abs(engine.bestLapS - 20) < 0.05);
  assert.ok(Math.abs(engine.bestSectors[0] - 5) < 0.05);
  assert.ok(Math.abs(engine.optimalLapS - 20) < 0.05);
  assert.equal(engine.sectorCount, 3);
});

test('LiveTiming reports delta versus the best lap on later laps', () => {
  const records = circleRecords({ laps: 3, pointsPerLap: 500 });
  const engine = new LiveTiming(trackWithSplits(records));
  const lapEvents = [];
  for (const r of records) {
    const ev = engine.push(r);
    if (ev && ev.type === 'lap') lapEvents.push(ev);
  }
  assert.ok(lapEvents.length >= 2);
  // The first completed lap becomes the reference, so the next delta is ~0.
  assert.equal(lapEvents[0].deltaS, null);
  assert.ok(Math.abs(lapEvents[1].deltaS) < 0.05);
});

test('LiveTiming tracks the current lap elapsed time live', () => {
  const records = circleRecords({ laps: 1, pointsPerLap: 500 });
  const engine = new LiveTiming(trackWithSplits(records));
  for (let i = 0; i < 200; i++) engine.push(records[i]);
  // 200 samples at 25 Hz = 8 s.
  assert.ok(Math.abs(engine.currentLapElapsedS - 8) < 0.05, `elapsed=${engine.currentLapElapsedS}`);
  assert.equal(engine.getSnapshot().sectorCount, 3);
  assert.equal(engine.getSnapshot().trackName, 'Karting test');
});

test('LiveTiming without a track still counts elapsed time but no laps', () => {
  const records = circleRecords({ laps: 1, pointsPerLap: 100 });
  const engine = new LiveTiming(null);
  let events = 0;
  for (const r of records) {
    if (engine.push(r)) events += 1;
  }
  assert.equal(events, 0);
  assert.equal(engine.laps.length, 0);
  assert.equal(engine.hasStartFinish, false);
  assert.ok(engine.currentLapElapsedS > 0);
});

test('LiveTiming reset clears the state for a new run', () => {
  const records = circleRecords({ laps: 2, pointsPerLane: 0, pointsPerLap: 500 });
  const engine = new LiveTiming(trackWithSplits(records));
  for (const r of records) engine.push(r);
  assert.ok(engine.laps.length > 0);
  engine.reset();
  assert.equal(engine.laps.length, 0);
  assert.equal(engine.bestLapS, null);
  assert.equal(engine.lapNumber, 0);
});
