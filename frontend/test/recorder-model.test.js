import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addGap,
  appVersion,
  buildSessionHeader,
  recordsDurationS,
} from '../src/features/live/recorderModel.js';

test('session header captures circuit, kart and RaceBox', () => {
  const header = buildSessionHeader({
    track: { id: 't1', name: 'Karting' },
    kart: '136',
    raceboxModel: 'RaceBox Mini S',
    raceboxId: 'dev1',
    preset: 'full',
    appVersion: '0.2.0',
    startedAt: '2026-10-19T00:00:00Z',
  });
  assert.deepEqual(header, {
    circuitId: 't1',
    circuitName: 'Karting',
    kart: '136',
    raceboxModel: 'RaceBox Mini S',
    raceboxId: 'dev1',
    preset: 'full',
    appVersion: '0.2.0',
    startedAt: '2026-10-19T00:00:00Z',
    driver: null,
  });
});

test('session header tolerates a missing track', () => {
  const header = buildSessionHeader({});
  assert.equal(header.circuitId, null);
  assert.equal(header.circuitName, null);
  assert.equal(header.kart, null);
});

test('gaps are de-duplicated inside the window', () => {
  const g1 = addGap([], 1000, 'racebox');
  assert.equal(g1.length, 1);
  assert.equal(addGap(g1, 1500, 'racebox'), g1);
  const g2 = addGap(g1, 4000, 'racebox');
  assert.equal(g2.length, 2);
  const g3 = addGap(g2, 4100, 'background');
  assert.equal(g3.length, 3);
});

test('records duration uses receivedAt', () => {
  assert.equal(recordsDurationS([{ receivedAt: 1000 }, { receivedAt: 6000 }]), 5);
  assert.equal(recordsDurationS([]), null);
  assert.equal(recordsDurationS(null), null);
});

test('app version resolves to a string', () => {
  assert.equal(typeof appVersion(), 'string');
});
