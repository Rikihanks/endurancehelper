import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig, applyConfigPatch, httpConfig } from '../config.js';

test('createDefaultConfig returns fresh deep clones', () => {
  const a = createDefaultConfig();
  const b = createDefaultConfig();
  assert.notEqual(a, b);
  assert.notEqual(a.race, b.race);
  a.race.ourKart = 'x';
  a.apex.host = 'changed';
  assert.equal(b.race.ourKart, null);
  assert.equal(b.apex.host, 'live-data.apex-timing.com');
});

test('applyConfigPatch coerces and sanitizes values', () => {
  const c = createDefaultConfig();
  applyConfigPatch(c, {
    ourKart: 42,
    raceObjective: 'mantener',
    theme: 'light',
    driverOrder: ['1', '2', -5],
    paceBadSec: '1.5',
    drivers: [
      { name: 'Ana', weightKg: '68', ballastKg: 0, category: 'fast' },
      { name: 'Bob', weightKg: 80, ballastKg: 5, category: 'hack' },
    ],
    numDrivers: 4,
  });
  assert.equal(c.race.ourKart, '42');
  assert.equal(c.race.raceObjective, 'mantener');
  assert.equal(c.ui.theme, 'light');
  assert.deepEqual(c.race.driverOrder, [1, 2]);
  assert.equal(c.strategy.paceBadSec, 1.5);
  assert.equal(c.race.drivers.length, 4, 'padded up to numDrivers');
  assert.equal(c.race.drivers[0].category, 'fast');
  assert.equal(c.race.drivers[1].category, 'avg', 'invalid category falls back to avg');
});

test('invalid enum values fall back to defaults', () => {
  const c = createDefaultConfig();
  applyConfigPatch(c, { theme: 'blue' });
  assert.equal(c.ui.theme, 'dark');
});

test('httpConfig is server-level and env driven', () => {
  assert.equal(typeof httpConfig.port, 'number');
  assert.equal(httpConfig.host, '0.0.0.0');
});
