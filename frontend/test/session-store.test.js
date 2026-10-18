import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

import { SessionStore } from '../src/services/storage/SessionStore.js';
import { TrackStore } from '../src/services/storage/TrackStore.js';

// Regression for the bug where SessionStore.list() returned only `meta`, losing
// the id: the session list then had items without id, "Ver" did nothing and
// IndexedDB reads with an undefined key threw "Provided data is inadequate".

function record(i) {
  return {
    iTOW: i * 40,
    latitude: 28.4671 + i * 1e-7,
    longitude: -16.3483,
    altitude: 900,
    speed: 40,
    heading: 10,
    gForceX: 100,
    gForceY: 200,
    gForceZ: 1000,
    rotRateX: 0,
    rotRateY: 0,
    rotRateZ: 0,
    batteryLevel: 90,
  };
}

test('sessions round-trip through IndexedDB keeping their id', async () => {
  const records = [record(0), record(1), record(2)];
  const id = await SessionStore.save({ meta: { name: 'Prueba La Esperanza' }, records });
  assert.ok(id, 'save returns an id');

  const list = await SessionStore.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id, 'list() must expose the id');
  assert.equal(list[0].name, 'Prueba La Esperanza');
  assert.equal(list[0].recordCount, 3);

  const full = await SessionStore.get(list[0].id);
  assert.ok(full);
  assert.equal(full.records.length, 3);
  assert.equal(full.records[1].iTOW, 40);

  await SessionStore.remove(id);
  assert.equal((await SessionStore.list()).length, 0);
});

test('reading a session with an undefined id rejects instead of hanging', async () => {
  await assert.rejects(() => SessionStore.get(undefined));
});

test('TrackStore keeps ids in the list (the editor relies on them)', async () => {
  const id = await TrackStore.save({
    name: 'Circuito de prueba',
    startFinish: { lat: 28.467124, lon: -16.3483065, heading: 357.6, width: 20, type: 'startFinish' },
    splits: [],
    centerline: [{ lat: 28.4671, lon: -16.3483 }, { lat: 28.4672, lon: -16.3484 }],
  });
  assert.ok(id);
  const list = await TrackStore.list();
  const found = list.find((t) => t.id === id);
  assert.ok(found, 'the saved track is listed with its id');
  assert.equal(found.startFinish.width, 20);
  assert.equal(found.centerline.length, 2);
  await TrackStore.remove(id);
});

test('ensureBuiltins inserts once and can refresh an unedited seed', async () => {
  const seed = {
    id: 'builtin:test-track',
    seedVersion: 1,
    name: 'Semilla',
    centerline: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }],
    startFinish: { lat: 1, lon: 1, heading: 0, width: 20 },
    splits: [],
  };
  const added = await TrackStore.ensureBuiltins([seed]);
  assert.equal(added, 1);
  assert.equal(await TrackStore.ensureBuiltins([seed]), 0, 'not inserted twice');

  const updated = await TrackStore.ensureBuiltins([{ ...seed, seedVersion: 2, name: 'Semilla v2' }]);
  assert.equal(updated, 0, 'refresh is not a new insert');
  const stored = await TrackStore.get('builtin:test-track');
  assert.equal(stored.name, 'Semilla v2');
  assert.equal(stored.seedVersion, 2);

  await TrackStore.remove('builtin:test-track');
});
