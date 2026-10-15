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
import { TelemetryService, attachTelemetry } from '../src/telemetry/service.js';
import { createDefaultConfig } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function baseSetup() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const licenseService = makeLicenseService(repos);
  return { db, repos, licenseService };
}

// Create a real org + running session so race_laps FK constraints hold.
async function makeSession(repos) {
  const user = await repos.createUser({ googleSub: randomUUID() });
  const org = await repos.createOrganization({ name: 'Tel Org', ownerUserId: user.id });
  const session = await repos.createRaceSession({ orgId: org.id, status: 'running' });
  return { org, session };
}

test('TelemetryService buffers, dedupes and flushes laps + events', async () => {
  const { repos } = baseSetup();
  const { session } = await makeSession(repos);
  const svc = new TelemetryService({ repos, raceSessionId: session.id, orgId: randomUUID(), flushMs: 60_000 });

  svc.recordLaps('77', [
    { lap: 1, total: 90000, s1: 10000, s2: 20000, s3: 60000 },
    { lap: 2, total: 91000, s1: 10100, s2: 20100, s3: 60800 },
  ]);
  svc.recordLaps('77', [{ lap: 2, total: 99999 }]); // duplicate lap -> ignored
  svc.recordPitStops('77', [{ pit: 1, lap: 15, pitTime: 30000, pitDriverId: 3 }]);
  svc.recordPitStops('77', [{ pit: 1, lap: 15, pitTime: 30000, pitDriverId: 3 }]); // duplicate

  await svc.flush();
  const laps = await repos.getRaceLapsForSession(session.id);
  assert.equal(laps.length, 2);
  assert.equal(laps[0].lapTimeMs, 90000);
  assert.deepEqual(laps[0].sectorTimes, { s1: 10000, s2: 20000, s3: 60000 });

  const events = await repos.getRaceEventsForSession(session.id);
  assert.equal(events.filter((e) => e.type === 'race_start').length, 1, 'race_start recorded once');
  assert.equal(events.filter((e) => e.type === 'pit_stop').length, 1, 'pit_stop recorded once');
});

test('TelemetryService.stop() flushes the remaining buffer (spec 25)', async () => {
  const { repos } = baseSetup();
  const { session } = await makeSession(repos);
  const svc = new TelemetryService({ repos, raceSessionId: session.id, orgId: randomUUID(), flushMs: 60_000 });
  svc.recordLaps('77', [{ lap: 1, total: 90000 }]);
  await svc.stop();
  assert.equal(await repos.getRaceLapsForSession(session.id).then((l) => l.length), 1, 'buffer flushed on stop');
});

test('attachTelemetry attaches telemetry to every runtime', () => {
  const { repos } = baseSetup();
  const manager = new RaceSessionManager();
  const hub = { broadcast: () => {} };
  const rt = manager.createSession({ raceSessionId: randomUUID(), orgId: randomUUID(), config: createDefaultConfig(), hub });

  const svc = attachTelemetry({ rt, repos });
  assert.ok(svc instanceof TelemetryService);
  assert.equal(rt.telemetry, svc);

  manager.stopAll();
});

// ---- HTTP layer ----
async function startTelemetryServer({ plan }) {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const licenseService = makeLicenseService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });
  const licenseMw = makeLicenseMiddleware({ licenseService });
  const manager = new RaceSessionManager();
  const hub = { broadcast: () => {} };

  const user = await repos.createUser({ googleSub: 'sub-t', email: 't@x.com', name: 'T' });
  const org = await repos.createOrganization({ name: 'T Org', ownerUserId: user.id });
  await repos.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });
  if (plan) await repos.createLicense({ orgId: org.id, plan, seats: 5, status: 'active' });
  const { token } = await sessionService.create(user.id);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', createAuthRouter({
    repos, sessionService,
    verifyGoogleIdToken: async () => ({ sub: 'sub-t', email: 't@x.com', name: 'T', picture: '' }),
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

test('HTTP: telemetry is attached on race start for every org', async () => {
  const a = await startTelemetryServer({ plan: 'monthly' });
  const b = await startTelemetryServer({ plan: 'annual' });
  try {
    for (const srv of [a, b]) {
      const created = await req(srv.base, 'POST', '/api/race-configs', srv.token, { name: 'C', payload: { race: {} } });
      const started = await req(srv.base, 'POST', '/api/race-sessions', srv.token, { raceConfigId: created.data.config.id });
      const rt = srv.manager.getSession(started.data.session.id);
      assert.ok(rt.telemetry, 'telemetry attached regardless of billing interval');
    }
  } finally {
    await a.manager.stopAll(); a.server.close();
    await b.manager.stopAll(); b.server.close();
  }
});

test('HTTP: post-race report aggregates persisted telemetry (all orgs)', async () => {
  const pro = await startTelemetryServer({ plan: 'annual' });
  try {
    const created = await req(pro.base, 'POST', '/api/race-configs', pro.token, { name: 'C', payload: { race: {} } });
    const started = await req(pro.base, 'POST', '/api/race-sessions', pro.token, { raceConfigId: created.data.config.id });
    const sessionId = started.data.session.id;

    await pro.repos.insertRaceLaps([
      { raceSessionId: sessionId, kart: '77', lapNumber: 1, lapTimeMs: 90000 },
      { raceSessionId: sessionId, kart: '77', lapNumber: 2, lapTimeMs: 91000 },
      { raceSessionId: sessionId, kart: '7', lapNumber: 1, lapTimeMs: 88000 },
    ]);
    await pro.repos.insertRaceEvents([
      { raceSessionId: sessionId, type: 'pit_stop', payloadJson: { kart: '77' } },
      { raceSessionId: sessionId, type: 'pit_stop', payloadJson: { kart: '77' } },
    ]);

    const rep = await req(pro.base, 'GET', `/api/race-sessions/${sessionId}/report`, pro.token);
    assert.equal(rep.status, 200);
    assert.equal(rep.data.report.totalLaps, 3);
    assert.equal(rep.data.report.bestLap, 88000);
    assert.equal(rep.data.report.stopCount, 0); // pit_stop rows without a numeric lap are ignored
    assert.equal(rep.data.report.perPilot.length, 1);
    assert.ok(rep.data.report.paceEvolution.length > 0);
  } finally {
    await pro.manager.stopAll(); pro.server.close();
  }
});

test('HTTP: report is available for every active license and 404 for foreign sessions', async () => {
  const a = await startTelemetryServer({ plan: 'monthly' });
  const b = await startTelemetryServer({ plan: 'annual' });
  try {
    const created = await req(a.base, 'POST', '/api/race-configs', a.token, { name: 'C', payload: { race: {} } });
    const started = await req(a.base, 'POST', '/api/race-sessions', a.token, { raceConfigId: created.data.config.id });
    const sessionId = started.data.session.id;

    // Any active license can read the report (no Pro gate).
    const own = await req(a.base, 'GET', `/api/race-sessions/${sessionId}/report`, a.token);
    assert.equal(own.status, 200);

    // Foreign session (another org) -> 404, never leaks data
    const foreign = await req(b.base, 'GET', `/api/race-sessions/${sessionId}/report`, b.token);
    assert.equal(foreign.status, 404);
    assert.equal(foreign.data.error, 'resource_not_found');
  } finally {
    await a.manager.stopAll(); a.server.close();
    await b.manager.stopAll(); b.server.close();
  }
});
