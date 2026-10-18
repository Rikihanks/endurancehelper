import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBackup,
  parseBackup,
  exportAll,
  importAll,
  BACKUP_APP,
  BACKUP_VERSION,
} from '../src/services/storage/backup.js';
import { SessionStore } from '../src/services/storage/SessionStore.js';
import { TrackStore } from '../src/services/storage/TrackStore.js';

function record(i) {
  return {
    iTOW: i * 40,
    latitude: 28.4671 + i * 1e-7,
    longitude: -16.3483,
    speed: 40,
    heading: 10,
    gForceX: 100,
    gForceY: -200,
    gForceZ: 1000,
  };
}

const TRACK = {
  id: 't-share-1',
  name: 'Circuito compartido',
  startFinish: { lat: 28.4671, lon: -16.3483, heading: 357.6, width: 20, type: 'startFinish', name: 'Meta' },
  splits: [{ lat: 28.4675, lon: -16.3485, heading: 90, width: 30, type: 'split', name: 'Sector 1' }],
  centerline: [
    { lat: 28.4671, lon: -16.3483 },
    { lat: 28.4675, lon: -16.3485 },
  ],
};

test('a backup round-trips sessions and tracks', () => {
  const text = JSON.stringify(
    buildBackup({
      sessions: [{ id: 's-1', meta: { name: 'Sesión A' }, records: [record(0), record(1)] }],
      tracks: [TRACK],
    }),
  );
  const parsed = parseBackup(text);
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.sessions[0].records.length, 2);
  assert.equal(parsed.sessions[0].meta.name, 'Sesión A');
  assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.tracks[0].splits.length, 1);
  assert.equal(parsed.tracks[0].splits[0].type, 'split');
});

test('parseBackup accepts a single session or a single track', () => {
  const onlySession = parseBackup(JSON.stringify({ meta: { name: 'Suelta' }, records: [record(0)] }));
  assert.equal(onlySession.sessions.length, 1);
  assert.equal(onlySession.tracks.length, 0);

  const onlyTrack = parseBackup(JSON.stringify(TRACK));
  assert.equal(onlyTrack.tracks.length, 1);
  assert.equal(onlyTrack.sessions.length, 0);
});

test('parseBackup rejects unusable files with a clear message', () => {
  assert.throws(() => parseBackup('no soy json'), /JSON/i);
  assert.throws(() => parseBackup(JSON.stringify({ app: BACKUP_APP, version: 99 })), /versión/i);
  assert.throws(
    () => parseBackup(JSON.stringify({ app: BACKUP_APP, version: BACKUP_VERSION, sessions: [], tracks: [] })),
    /no contiene/i,
  );
  assert.throws(() => parseBackup(JSON.stringify({ hola: 'mundo' })), /no parece/i);
});

test('parseBackup drops invalid records and points instead of failing', () => {
  const text = JSON.stringify({
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    sessions: [
      {
        meta: {},
        records: [record(0), { latitude: 'x', longitude: 1 }, null, record(2)],
      },
    ],
    tracks: [{ ...TRACK, centerline: [{ lat: 1, lon: 1 }, { lat: 'a', lon: 2 }, { lat: 2, lon: 2 }] }],
  });
  const parsed = parseBackup(text);
  assert.equal(parsed.sessions[0].records.length, 2);
  assert.equal(parsed.sessions[0].meta.name, 'Sesión importada');
  assert.equal(parsed.tracks[0].centerline.length, 2);
});

test('exportAll/importAll move data through the stores', async () => {
  // Seed a session and a track locally.
  const sessionId = await SessionStore.save({ meta: { name: 'Para exportar' }, records: [record(0), record(1), record(2)] });
  await TrackStore.save(TRACK);

  const { backup, counts } = await exportAll();
  assert.ok(counts.sessions >= 1);
  assert.ok(counts.tracks >= 1);
  assert.equal(backup.app, BACKUP_APP);
  const text = JSON.stringify(backup);

  const exportedSession = backup.sessions.find((s) => s.id === sessionId);
  assert.ok(exportedSession, 'the session is exported with its records');
  assert.equal(exportedSession.records.length, 3);
  assert.ok(backup.tracks.some((t) => t.id === TRACK.id));

  // Importing the same backup twice is harmless (merge by id).
  const first = await importAll(text);
  const second = await importAll(text);
  assert.equal(first.sessions, second.sessions);
  assert.equal(first.tracks, second.tracks);

  const sessions = await SessionStore.list();
  const sameSession = sessions.filter((s) => s.id === sessionId);
  assert.equal(sameSession.length, 1, 'no duplicated session');
  assert.equal(sameSession[0].recordCount, 3);

  const track = await TrackStore.get(TRACK.id);
  assert.equal(track.splits.length, 1);
  assert.equal(track.centerline.length, 2);
});
