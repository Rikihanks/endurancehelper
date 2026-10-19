import test from 'node:test';
import assert from 'node:assert/strict';

import { RaceBoxLiveBridge } from '../src/services/devices/racebox/RaceBoxLiveBridge.js';
import { makeTrap } from '../src/services/devices/racebox/RaceBoxTrack.js';

const BASE = { lat: 28.45, lon: -16.36 };

function circleRecords({ laps = 4, pointsPerLap = 500, radiusM = 80, stepForLap = () => 40 } = {}) {
  const records = [];
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos((BASE.lat * Math.PI) / 180);
  let itow = 1000;
  const total = laps * pointsPerLap + 1;
  for (let i = 0; i < total; i += 1) {
    const lap = Math.floor(i / pointsPerLap);
    if (i > 0) itow += stepForLap(lap);
    const ang = (2 * Math.PI * i) / pointsPerLap;
    records.push({
      iTOW: itow,
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
    startFinish: makeTrap({
      lat: at(0).latitude,
      lon: at(0).longitude,
      heading: at(0).heading,
      width: 60,
      type: 'startFinish',
    }),
    splits: [
      makeTrap({ lat: at(125).latitude, lon: at(125).longitude, heading: at(125).heading, width: 40, type: 'split', name: 'S1' }),
      makeTrap({ lat: at(375).latitude, lon: at(375).longitude, heading: at(375).heading, width: 40, type: 'split', name: 'S2' }),
    ],
  };
}

test('bridge exposes lap numbers, best/last and sectors', () => {
  const records = circleRecords({ laps: 4 });
  const bridge = new RaceBoxLiveBridge(trackWithSplits(records));
  for (const record of records) bridge.push(record);

  const ctx = bridge.getContext();
  assert.equal(ctx.started, true);
  assert.equal(ctx.currentLap, 4);
  assert.equal(ctx.laps, 3);
  assert.equal(ctx.bestLapNumber, 1);
  assert.equal(ctx.lastLapNumber, 3);
  assert.ok(Math.abs(ctx.bestLapS - 20) < 0.05, `best=${ctx.bestLapS}`);
  assert.ok(Math.abs(ctx.lastLapS - 20) < 0.05, `last=${ctx.lastLapS}`);
  assert.ok(Math.abs(ctx.deltaSeconds) < 0.05, `delta=${ctx.deltaSeconds}`);
  assert.equal(ctx.sectorCount, 3);
  assert.equal(ctx.bestSectors.length, 3);
  assert.equal(ctx.lastSectors.length, 3);
});

test('live delta is computed by distance against the best lap', () => {
  const records = circleRecords({ laps: 4, stepForLap: (lap) => (lap >= 2 ? 44 : 40) });
  const bridge = new RaceBoxLiveBridge(trackWithSplits(records));
  for (let i = 0; i <= 1750; i += 1) bridge.push(records[i]);

  const ctx = bridge.getContext();
  assert.equal(ctx.currentLap, 3);
  assert.equal(ctx.bestLapNumber, 1);
  assert.equal(ctx.lastLapNumber, 2);
  assert.ok(Math.abs(ctx.lastLapS - 22) < 0.1, `last=${ctx.lastLapS}`);
  assert.ok(ctx.deltaSeconds > 0.9 && ctx.deltaSeconds < 1.2, `delta=${ctx.deltaSeconds}`);
  assert.equal(ctx.currentSectors.length, 1);
});

test('bridge without a track counts nothing', () => {
  const bridge = new RaceBoxLiveBridge(null);
  for (const record of circleRecords({ laps: 1, pointsPerLap: 100 })) bridge.push(record);

  const ctx = bridge.getContext();
  assert.equal(ctx.started, false);
  assert.equal(ctx.laps, 0);
  assert.equal(ctx.sectorCount, 0);
  assert.equal(ctx.deltaSeconds, null);
});
