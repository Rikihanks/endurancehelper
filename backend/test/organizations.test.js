import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createMemDb } from './helpers/pgmem.js';
import { makeRepos } from '../src/db/repos.js';
import { makeSessionService } from '../src/auth/session.js';
import { makeAuthMiddleware } from '../src/auth/middleware.js';
import { createAuthRouter } from '../src/auth/routes.js';
import { createOrganizationsRouter } from '../src/organizations/routes.js';
import { createRaceConfigsRouter } from '../src/raceConfigs/routes.js';
import { makeLicenseService, makeLicenseMiddleware } from '../src/billing/license.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function startServer() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const licenseService = makeLicenseService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });
  const licenseMw = makeLicenseMiddleware({ licenseService });

  const user = await repos.createUser({ googleSub: 'sub-on', email: 'on@x.com', name: 'On' });
  const { token } = await sessionService.create(user.id);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', createAuthRouter({
    repos, sessionService,
    verifyGoogleIdToken: async () => ({ sub: 'sub-on', email: 'on@x.com', name: 'On', picture: '' }),
    requireAuth: authMw.requireAuth,
    googleClientId: 'c',
  }));
  app.use('/api/organizations', authMw.requireAuth, createOrganizationsRouter({ repos }));
  app.use('/api/race-configs', authMw.requireAuth, licenseMw.requireActiveLicense, createRaceConfigsRouter({ repos, licenseService }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://localhost:${server.address().port}`, repos, token };
}

function authed(token) { return { headers: { 'Content-Type': 'application/json', Cookie: `eh_session=${token}` } }; }
async function req(base, method, pathname, token, body) {
  const opts = authed(token);
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${pathname}`, { method, ...opts });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const drivers = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, weightKg: 75, ballastKg: 0, category: 'avg' }));

test('onboarding creates org WITHOUT a license (must subscribe) + default config', async () => {
  const { server, base, repos, token } = await startServer();
  try {
    const res = await req(base, 'POST', '/api/organizations', token, {
      name: 'Team Alfa',
      drivers: drivers(3),
      circuitUrl: 'https://www.apex-timing.com/live-timing/kartcenter-campillos/index.html',
      strategy: { paceBadSec: 1.5, paceDropPct: 5 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.org.plan, null, 'no license until the user subscribes');
    assert.ok(res.data.configId);

    const org = await repos.getOrganizationById(res.data.org.id);
    assert.equal(org.name, 'Team Alfa');
    assert.equal(await repos.getLicenseByOrgId(res.data.org.id), null, 'no license auto-created');

    const configs = await repos.listRaceConfigs(res.data.org.id);
    assert.equal(configs.length, 1);
    const p = configs[0].payloadJson;
    assert.equal(p.race.numDrivers, 3);
    assert.equal(p.race.drivers.length, 3);
    assert.equal(p.apex.circuitUrl, 'https://www.apex-timing.com/live-timing/kartcenter-campillos/index.html');
    assert.equal(p.strategy.paceBadSec, 1.5, 'strategy threshold persisted');
    assert.equal(p.strategy.paceDropPct, 5);
    assert.equal(p.strategy.paceGoodSec, 0.3, 'missing thresholds fall back to defaults');
  } finally { server.close(); }
});

test('onboarding stores an empty circuit URL when omitted', async () => {
  const { server, base, repos, token } = await startServer();
  try {
    const res = await req(base, 'POST', '/api/organizations', token, { name: 'Team B', drivers: drivers(1) });
    assert.equal(res.status, 200);
    const configs = await repos.listRaceConfigs(res.data.org.id);
    assert.equal(configs[0].payloadJson.apex.circuitUrl, '');
  } finally { server.close(); }
});

test('onboarding rejects more than 10 drivers and requires inputs', async () => {
  const { server, base, token } = await startServer();
  try {
    const tooMany = await req(base, 'POST', '/api/organizations', token, { name: 'Big Team', drivers: drivers(11) });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.data.message, /Up to 10/);

    const noName = await req(base, 'POST', '/api/organizations', token, { drivers: drivers(1) });
    assert.equal(noName.status, 400);

    const noDrivers = await req(base, 'POST', '/api/organizations', token, { name: 'X' });
    assert.equal(noDrivers.status, 400);
  } finally { server.close(); }
});

test('second onboarding attempt is a conflict', async () => {
  const { server, base, token } = await startServer();
  try {
    const first = await req(base, 'POST', '/api/organizations', token, { name: 'Team A', drivers: drivers(2) });
    assert.equal(first.status, 200);
    const second = await req(base, 'POST', '/api/organizations', token, { name: 'Team B', drivers: drivers(1) });
    assert.equal(second.status, 409);
    assert.equal(second.data.error, 'conflict');
  } finally { server.close(); }
});

test('GET /me returns org + billing interval; owner can rename', async () => {
  const { server, base, token } = await startServer();
  try {
    await req(base, 'POST', '/api/organizations', token, { name: 'Team A', drivers: drivers(2) });

    const me = await req(base, 'GET', '/api/organizations/me', token);
    assert.equal(me.status, 200);
    assert.equal(me.data.org.name, 'Team A');
    assert.equal(me.data.org.plan, null, 'no billing interval before subscribing');

    const rename = await req(base, 'PUT', '/api/organizations/me', token, { name: 'Team Renamed' });
    assert.equal(rename.status, 200);
    assert.equal(rename.data.org.name, 'Team Renamed');

    const bad = await req(base, 'PUT', '/api/organizations/me', token, { name: '' });
    assert.equal(bad.status, 400);
  } finally { server.close(); }
});

test('GET /me/license returns the org license (or null)', async () => {
  const { server, base, token, repos } = await startServer();
  try {
    const onboard = await req(base, 'POST', '/api/organizations', token, { name: 'Team A', drivers: drivers(2) });
    const orgId = onboard.data.org.id;

    const none = await req(base, 'GET', '/api/organizations/me/license', token);
    assert.equal(none.status, 200);
    assert.equal(none.data.license, null);

    await repos.createLicense({ orgId, plan: 'annual', seats: 5, status: 'active' });
    const has = await req(base, 'GET', '/api/organizations/me/license', token);
    assert.equal(has.data.license.plan, 'annual');
    assert.equal(has.data.license.seats, 5);
    assert.equal(has.data.license.status, 'active');
  } finally { server.close(); }
});

test('up to 10 drivers are allowed at race-config save', async () => {
  const { server, base, repos, token } = await startServer();
  try {
    const onboard = await req(base, 'POST', '/api/organizations', token, { name: 'Team A', drivers: drivers(2) });
    const orgId = onboard.data.org.id;

    // Needs an active license to pass requireActiveLicense.
    await repos.createLicense({ orgId, plan: 'annual', seats: 10, status: 'active' });

    const ok = await req(base, 'POST', '/api/race-configs', token, { name: '10D', payload: { race: { numDrivers: 10, drivers: drivers(10) } } });
    assert.equal(ok.status, 200);
  } finally { server.close(); }
});
