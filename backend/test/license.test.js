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
import { makeLicenseService, makeLicenseMiddleware, isLicenseActive } from '../src/billing/license.js';
import { createWsAuthorizer } from '../src/auth/wsAuthorizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function setup() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const licenseService = makeLicenseService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });
  const licenseMw = makeLicenseMiddleware({ licenseService });
  return { db, repos, sessionService, licenseService, authMw, licenseMw };
}

// Create a user + org (+ optional license + session cookie value).
async function makeAuthed({ repos, sessionService }, { withLicense = false, licenseStatus = 'active' } = {}) {
  const user = await repos.createUser({ googleSub: 'sub-lic', email: 'l@x.com', name: 'Lic' });
  const org = await repos.createOrganization({ name: 'Org Lic', ownerUserId: user.id });
  await repos.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });
  if (withLicense) {
    await repos.createLicense({ orgId: org.id, plan: 'pro', seats: 5, status: licenseStatus });
  }
  const { token } = await sessionService.create(user.id);
  return { user, org, token };
}

function startProtectedServer({ repos, authMw, licenseMw }) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // A protected sample route that requires auth + active license.
  app.get('/api/protected', authMw.requireAuth, licenseMw.requireActiveLicense, (req, res) => {
    res.json({ ok: true, orgId: req.user.orgId });
  });
  const server = app.listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve({ server, base: `http://localhost:${server.address().port}` })));
}

async function get(base, cookie) {
  const res = await fetch(`${base}/api/protected`, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('isLicenseActive only allows explicit statuses', () => {
  assert.equal(isLicenseActive({ status: 'active' }), true);
  assert.equal(isLicenseActive({ status: 'trialing' }), true);
  assert.equal(isLicenseActive({ status: 'canceled' }), false);
  assert.equal(isLicenseActive({ status: 'past_due' }), false);
  assert.equal(isLicenseActive({ status: 'expired' }), false);
  assert.equal(isLicenseActive(null), false);
  assert.equal(isLicenseActive(undefined), false);
});

test('seatsAvailable counts members against license seats', async () => {
  const { repos, licenseService } = setup();
  const user = await repos.createUser({ googleSub: 's1' });
  const org = await repos.createOrganization({ name: 'Seat Org', ownerUserId: user.id });
  await repos.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });

  assert.equal(await licenseService.seatsAvailable(org.id), 0, 'no license -> 0 seats');

  await repos.createLicense({ orgId: org.id, plan: 'pro', seats: 5, status: 'active' });
  assert.equal(await licenseService.seatsAvailable(org.id), 4, '5 seats - 1 member');

  const u2 = await repos.createUser({ googleSub: 's2' });
  await repos.createMembership({ userId: u2.id, orgId: org.id, role: 'member' });
  assert.equal(await licenseService.seatsAvailable(org.id), 3);
});

test('protected route: no auth -> 401', async () => {
  const s = setup();
  const { server, base } = await startProtectedServer({ repos: s.repos, authMw: s.authMw, licenseMw: s.licenseMw });
  try {
    const r = await get(base);
    assert.equal(r.status, 401);
  } finally { server.close(); }
});

test('protected route: authed but no license -> 402 license_required', async () => {
  const s = setup();
  const { token } = await makeAuthed(s, { withLicense: false });
  const { server, base } = await startProtectedServer({ repos: s.repos, authMw: s.authMw, licenseMw: s.licenseMw });
  try {
    const r = await get(base, `eh_session=${token}`);
    assert.equal(r.status, 402);
    assert.equal(r.data.error, 'license_required');
  } finally { server.close(); }
});

test('protected route: license canceled -> 402', async () => {
  const s = setup();
  const { token } = await makeAuthed(s, { withLicense: true, licenseStatus: 'canceled' });
  const { server, base } = await startProtectedServer({ repos: s.repos, authMw: s.authMw, licenseMw: s.licenseMw });
  try {
    const r = await get(base, `eh_session=${token}`);
    assert.equal(r.status, 402);
  } finally { server.close(); }
});

test('protected route: active license -> 200 with orgId', async () => {
  const s = setup();
  const { token, org } = await makeAuthed(s, { withLicense: true });
  const { server, base } = await startProtectedServer({ repos: s.repos, authMw: s.authMw, licenseMw: s.licenseMw });
  try {
    const r = await get(base, `eh_session=${token}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.orgId, org.id);
  } finally { server.close(); }
});

test('WS authorizer: valid session + active license -> ok', async () => {
  const s = setup();
  const { token, org } = await makeAuthed(s, { withLicense: true });
  const authorize = createWsAuthorizer({ repos: s.repos, sessionService: s.sessionService, licenseService: s.licenseService });
  const ctx = await authorize({ headers: { cookie: `eh_session=${token}` } });
  assert.equal(ctx.ok, true);
  assert.equal(ctx.orgId, org.id);
});

test('WS authorizer: no cookie -> 4401', async () => {
  const s = setup();
  const authorize = createWsAuthorizer({ repos: s.repos, sessionService: s.sessionService, licenseService: s.licenseService });
  const ctx = await authorize({ headers: {} });
  assert.equal(ctx.ok, undefined);
  assert.equal(ctx.code, 4401);
});

test('WS authorizer: authed but no license -> 4402', async () => {
  const s = setup();
  const { token } = await makeAuthed(s, { withLicense: false });
  const authorize = createWsAuthorizer({ repos: s.repos, sessionService: s.sessionService, licenseService: s.licenseService });
  const ctx = await authorize({ headers: { cookie: `eh_session=${token}` } });
  assert.equal(ctx.ok, undefined);
  assert.equal(ctx.code, 4402);
});
