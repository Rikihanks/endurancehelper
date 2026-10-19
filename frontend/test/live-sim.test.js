import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSimulation } from '../src/features/live/demoTrack.js';
import { RaceBoxLiveBridge } from '../src/services/devices/racebox/RaceBoxLiveBridge.js';

test('simulation drives laps, sectors and delta from a builtin track', () => {
  const simulation = buildSimulation({ laps: 2, hz: 25 });
  assert.ok(simulation, 'simulation was built');
  assert.equal(simulation.track.splits.length, 2);
  assert.ok(simulation.records.length > 100);

  const bridge = new RaceBoxLiveBridge(simulation.track);
  for (const record of simulation.records) bridge.push(record);

  const ctx = bridge.getContext();
  assert.ok(ctx.laps >= 2, `laps=${ctx.laps}`);
  assert.equal(ctx.sectorCount, 3);
  assert.ok(ctx.bestLapS > 0, `best=${ctx.bestLapS}`);
  assert.ok(ctx.lastSectors.length === 3);
  assert.ok(Number.isFinite(ctx.deltaSeconds), `delta=${ctx.deltaSeconds}`);
});

test('simulation falls back to a builtin track for an unusable track', () => {
  const simulation = buildSimulation({ track: { centerline: [] } });
  assert.ok(simulation, 'builtin fallback was used');
  assert.ok(simulation.records.length > 100);
});
