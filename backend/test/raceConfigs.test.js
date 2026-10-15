import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createMemDb } from './helpers/pgmem.js';
import { makeRepos } from '../src/db/repos.js';
import { makeSessionService } from '../src/auth/session.js';
import { makeAuthMiddleware } from '../src/auth/middleware.js';
import { createAuthRouter } from '../src/auth/routes.js';
import { makeLicenseService, makeLicenseMiddleware } from '../src/billing/license.js';
import { RaceSessionManager } from '../src/raceSessionManager.js';
import { createRaceConfigsRouter } from '../src/raceConfigs/routes.js';
import { createRaceSessionsRouter } from '../src/raceSessions/routes.js';
import { recoverRunningSessions } from '../src/recovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function startServer() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const licenseService = makeLicenseService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });
  const licenseMw = makeLicenseMiddleware({ licenseService });
  const manager = new RaceSessionManager();
  const hub = { broadcast: () => {}, disconnectOrgEsp32: () => 0, notifyOrgEsp32Status: () => {} };

  const user = await repos.createUser({ googleSub: 'sub-r5', email: 'r5@x.com', name: 'R5' });
  const org = await repos.createOrganization({ name: 'R5 Org', ownerUserId: user.id });
  await repos.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });
  await repos.createLicense({ orgId: org.id, plan: 'pro', seats: 5, status: 'active' });
  const { token } = await sessionService.create(user.id);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', createAuthRouter({
    repos, sessionService,
    verifyGoogleIdToken: async () => ({ sub: 'sub-r5', email: 'r5@x.com', name: 'R5', picture: '' }),
    requireAuth: authMw.requireAuth,
    googleClientId: 'c',
  }));
  const guard = [authMw.requireAuth, licenseMw.requireActiveLicense];
  app.use('/api/race-configs', ...guard, createRaceConfigsRouter({ repos }));
  app.use('/api/race-sessions', ...guard, createRaceSessionsRouter({ repos, manager, hub, resolveOnStart: false }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://localhost:${server.address().port}`, repos, manager, token, org };
}

function authed(token) { return { headers: { 'Content-Type': 'application/json', Cookie: `eh_session=${token}` } }; }

async function req(base, method, pathname, token, body) {
  const opts = authed(token);
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${pathname}`, { method, ...opts });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('race-configs CRUD is org-scoped', async () => {
  const { server, base, token } = await startServer();
  try {
    const created = await req(base, 'POST', '/api/race-configs', token, { name: 'K1 8H', payload: { race: { ourKart: '77' } } });
    assert.equal(created.status, 200);
    assert.ok(created.data.config.id);
    const id = created.data.config.id;

    const list = await req(base, 'GET', '/api/race-configs', token);
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.configs.map((c) => c.id), [id]);

    const got = await req(base, 'GET', `/api/race-configs/${id}`, token);
    assert.equal(got.data.config.name, 'K1 8H');

    const upd = await req(base, 'PUT', `/api/race-configs/${id}`, token, { name: 'K1 8H v2', payload: { race: { ourKart: '99' } } });
    assert.equal(upd.data.config.name, 'K1 8H v2');
    assert.equal(upd.data.config.payload.race.ourKart, '99');

    // Unknown / foreign ids -> 404 (never leaks data)
    const missing = await req(base, 'GET', `/api/race-configs/${randomUUID()}`, token);
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, 'resource_not_found');

    const del = await req(base, 'DELETE', `/api/race-configs/${id}`, token);
    assert.equal(del.data.ok, true);
    const listAfter = await req(base, 'GET', '/api/race-configs', token);
    assert.equal(listAfter.data.configs.length, 0);
  } finally { server.close(); }
});

test('validation: create requires name and payload', async () => {
  const { server, base, token } = await startServer();
  try {
    const noName = await req(base, 'POST', '/api/race-configs', token, { payload: {} });
    assert.equal(noName.status, 400);
    const noPayload = await req(base, 'POST', '/api/race-configs', token, { name: 'X' });
    assert.equal(noPayload.status, 400);
  } finally { server.close(); }
});

test('starting a race freezes the config snapshot', async () => {
  const { server, base, token, manager, repos, org } = await startServer();
  try {
    const created = await req(base, 'POST', '/api/race-configs', token, {
      name: 'Endurance 6H',
      payload: { race: { ourKart: '77', ourTeamName: 'A' }, apex: { circuitUrl: 'https://circuit.test' } },
    });
    const started = await req(base, 'POST', '/api/race-sessions', token, { raceConfigId: created.data.config.id });
    assert.equal(started.status, 200);
    assert.equal(started.data.session.status, 'running');
    const sessionId = started.data.session.id;

    assert.ok(manager.hasSession(sessionId), 'runtime created in manager');
    const rt = manager.getSession(sessionId);
    assert.equal(rt.config.race.ourKart, '77');

    // Mutating the original config must NOT change the running race.
    await req(base, 'PUT', `/api/race-configs/${created.data.config.id}`, token, { payload: { race: { ourKart: '99' } } });
    assert.equal(manager.getSession(sessionId).config.race.ourKart, '77', 'frozen config unaffected');

    // DB session carries the frozen snapshot for recovery.
    const dbSession = await repos.getRaceSession(org.id, sessionId);
    assert.equal(dbSession.configJson.race.ourKart, '77');

    // state endpoint serves the runtime snapshot.
    const state = await req(base, 'GET', `/api/race-sessions/${sessionId}/state`, token);
    assert.equal(state.status, 200);
    assert.ok(state.data.view);
  } finally { await manager.stopAll(); server.close(); }
});

test('finishing a race stops the runtime and marks it finished', async () => {
  const { server, base, token, manager, repos, org } = await startServer();
  try {
    const created = await req(base, 'POST', '/api/race-configs', token, { name: 'C', payload: { race: {} } });
    const started = await req(base, 'POST', '/api/race-sessions', token, { raceConfigId: created.data.config.id });
    const sessionId = started.data.session.id;
    assert.ok(manager.hasSession(sessionId));

    const fin = await req(base, 'POST', `/api/race-sessions/${sessionId}/finish`, token, {});
    assert.equal(fin.status, 200);
    assert.equal(fin.data.ok, true);
    assert.equal(manager.hasSession(sessionId), false, 'runtime stopped');

    const dbSession = await repos.getRaceSession(org.id, sessionId);
    assert.equal(dbSession.status, 'finished');
    assert.ok(dbSession.endedAt, 'endedAt set');

    // Finishing a non-existent session -> 404
    const missing = await req(base, 'POST', `/api/race-sessions/${randomUUID()}/finish`, token, {});
    assert.equal(missing.status, 404);
  } finally { manager.stopAll(); server.close(); }
});

test('deleting a race session stops runtime and removes it permanently', async () => {
  const { server, base, token, manager, repos, org } = await startServer();
  try {
    const created = await req(base, 'POST', '/api/race-configs', token, { name: 'C', payload: { race: {} } });
    const started = await req(base, 'POST', '/api/race-sessions', token, { raceConfigId: created.data.config.id });
    const sessionId = started.data.session.id;
    assert.ok(manager.hasSession(sessionId));

    const del = await req(base, 'DELETE', `/api/race-sessions/${sessionId}`, token);
    assert.equal(del.data.ok, true);
    assert.equal(manager.hasSession(sessionId), false, 'runtime removed');

    // The row is GONE, not just marked stopped.
    const dbSession = await repos.getRaceSession(org.id, sessionId);
    assert.equal(dbSession, null, 'session hard-deleted from DB');
  } finally { manager.stopAll(); server.close(); }
});

test('recovery recreates runtimes for running sessions and flags failures', async () => {
  const { server, base, repos, manager, org } = await startServer();
  try {
  const hub = { broadcast: () => {}, disconnectOrgEsp32: () => 0, notifyOrgEsp32Status: () => {} };
    const goodId = randomUUID();
    const badId = randomUUID();
    await repos.createRaceSession({ id: goodId, orgId: org.id, status: 'running', circuitUrl: 'https://g', configJson: { race: { ourKart: '5' } } });
    await repos.createRaceSession({ id: badId, orgId: org.id, status: 'running', circuitUrl: null, configJson: { race: {} } });

    // Force the bad session to fail recovery (spec: -> status 'recovering').
    const origCreate = manager.createSession.bind(manager);
    manager.createSession = (opts) => {
      if (opts.raceSessionId === badId) throw new Error('boom');
      return origCreate(opts);
    };

    const count = await recoverRunningSessions({ repos, manager, hub, connect: false });
    assert.equal(count, 2);
    assert.ok(manager.hasSession(goodId), 'good session has runtime');
    assert.equal(manager.getSession(goodId).config.race.ourKart, '5');

    const bad = await repos.getRaceSession(org.id, badId);
    assert.equal(bad.status, 'recovering', 'failed session marked recovering, not finished');
  } finally { await manager.stopAll(); server.close(); }
});
