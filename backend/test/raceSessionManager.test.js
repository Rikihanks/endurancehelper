import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RaceSessionManager } from '../src/raceSessionManager.js';
import { createDefaultConfig } from '../config.js';

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-sessions-'));

after(() => {
  try { fs.rmSync(TMP_DATA, { recursive: true, force: true }); } catch (_) {}
});

function makeHub() {
  const calls = [];
  return {
    calls,
    broadcast(room, snapshot) { calls.push({ room, snapshot }); },
  };
}

test('createSession / getSession / hasSession / removeSession', async () => {
  const manager = new RaceSessionManager();
  const config = createDefaultConfig();
  config.race.ourKart = '78';
  const rt = manager.createSession({ raceSessionId: 's1', orgId: 'org-a', config, hub: makeHub(), dataDir: TMP_DATA });

  assert.ok(manager.hasSession('s1'));
  assert.equal(manager.getSession('s1'), rt);
  assert.equal(manager.hasSession('missing'), false);
  assert.equal(manager.getSession('missing'), null);

  assert.equal(await manager.removeSession('s1'), true);
  assert.equal(manager.hasSession('s1'), false);
  assert.equal(await manager.removeSession('s1'), false);

  await manager.stopAll();
});

test('two sessions have fully isolated runtime state', async () => {
  const manager = new RaceSessionManager();
  const cfgA = createDefaultConfig(); cfgA.race.ourKart = '1';
  const cfgB = createDefaultConfig(); cfgB.race.ourKart = '2';

  const rtA = manager.createSession({ raceSessionId: 'A', orgId: 'org-a', config: cfgA, hub: makeHub(), dataDir: TMP_DATA });
  const rtB = manager.createSession({ raceSessionId: 'B', orgId: 'org-b', config: cfgB, hub: makeHub(), dataDir: TMP_DATA });

  // Distinct runtime objects
  assert.notEqual(rtA.config, rtB.config);
  assert.notEqual(rtA.strategyEngine, rtB.strategyEngine);
  assert.notEqual(rtA.apexClient, rtB.apexClient);
  assert.notEqual(rtA.apexClient.getState(), rtB.apexClient.getState());
  assert.notEqual(rtA.qualyStore, rtB.qualyStore);

  // Mutating A must NOT leak into B
  rtA.config.race.ourKart = '99';
  rtA.apexClient.getState().drivers.push({ id: 'x', kart: 'x' });
  assert.equal(rtB.config.race.ourKart, '2');
  assert.equal(rtB.apexClient.getState().drivers.length, 0);

  // Engine is wired to its own config
  assert.equal(rtA.strategyEngine.config.race.ourKart, '99');
  assert.equal(rtB.strategyEngine.config.race.ourKart, '2');

  await manager.stopAll();
});

test('stopping one session does not affect the others', async () => {
  const manager = new RaceSessionManager();
  const rtA = manager.createSession({ raceSessionId: 'A', orgId: 'o1', config: createDefaultConfig(), hub: makeHub(), dataDir: TMP_DATA });
  const rtB = manager.createSession({ raceSessionId: 'B', orgId: 'o2', config: createDefaultConfig(), hub: makeHub(), dataDir: TMP_DATA });

  assert.equal(await manager.stopSession('A'), true);
  // Stopped session is kept (for recovery) but B is untouched.
  assert.equal(manager.hasSession('A'), true);
  assert.equal(manager.hasSession('B'), true);
  assert.equal(rtB.apexClient.connected, false);

  await manager.stopAll();
});

test('concurrency: Race A and Race B run without sharing state', async () => {
  const manager = new RaceSessionManager();
  const hubA = makeHub();
  const hubB = makeHub();

  const rtA = manager.createSession({ raceSessionId: 'A', orgId: 'org-a', config: createDefaultConfig(), hub: hubA, dataDir: TMP_DATA });
  const rtB = manager.createSession({ raceSessionId: 'B', orgId: 'org-b', config: createDefaultConfig(), hub: hubB, dataDir: TMP_DATA });

  // Distinct identities for engine / client / config / websocket room
  assert.notEqual(rtA.strategyEngine, rtB.strategyEngine);
  assert.notEqual(rtA.apexClient, rtB.apexClient);
  assert.notEqual(rtA.config, rtB.config);

  rtA.broadcast();
  rtB.broadcast();
  assert.equal(hubA.calls.length, 1);
  assert.equal(hubB.calls.length, 1);
  assert.equal(hubA.calls[0].room, 'race:A');
  assert.equal(hubB.calls[0].room, 'race:B');

  // A snapshot for A never carries B's data and vice versa.
  const snapA = rtA.getSnapshot();
  const snapB = rtB.getSnapshot();
  assert.equal(snapA.connected, false);
  assert.equal(snapB.connected, false);

  await manager.stopAll();
});

test('getSnapshot builds a view model without throwing', async () => {
  const manager = new RaceSessionManager();
  const rt = manager.createSession({ raceSessionId: 'S', orgId: 'o1', config: createDefaultConfig(), hub: makeHub(), dataDir: TMP_DATA });
  const snap = rt.getSnapshot();
  assert.equal(snap.connected, false);
  assert.ok(snap.view, 'view model present');
  assert.ok(snap.view.topbar, 'topbar present');
  assert.ok(Array.isArray(snap.view.standings), 'standings present');
  await manager.stopAll();
});
