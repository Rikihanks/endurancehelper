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
import { createAdminRouter } from '../src/admin/routes.js';
import { errorHandler } from '../src/server/middleware.js';
import { hashTeamPassword, verifyTeamPassword } from '../src/esp32/password.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function startServer() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });

  const adminU = await repos.createUser({ googleSub: 'ga', email: 'ga@x.com', name: 'Global Admin', role: 'admin' });
  const norm = await repos.createUser({ googleSub: 'nu', email: 'norm@x.com', name: 'Normal' });
  const { token: adminToken } = await sessionService.create(adminU.id);
  const { token: normalToken } = await sessionService.create(norm.id);

  // Two teams, each with a device + a provisioning password hash.
  const orgA = await repos.createOrganization({ name: 'Team A', ownerUserId: adminU.id });
  await repos.createMembership({ userId: adminU.id, orgId: orgA.id, role: 'owner' });
  await repos.updateOrganization(orgA.id, { devicePasswordHash: hashTeamPassword('pwA'), devicePasswordCreatedAt: new Date() });
  await repos.upsertEsp32Device({ orgId: orgA.id, uuid: 'CHIP-A', deviceName: 'Kart A' });

  const orgB = await repos.createOrganization({ name: 'Team B', ownerUserId: adminU.id });
  await repos.createMembership({ userId: adminU.id, orgId: orgB.id, role: 'owner' });
  await repos.updateOrganization(orgB.id, { devicePasswordHash: hashTeamPassword('pwB'), devicePasswordCreatedAt: new Date() });
  await repos.upsertEsp32Device({ orgId: orgB.id, uuid: 'CHIP-B', deviceName: 'Kart B' });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/admin', authMw.requireAuth, authMw.requireGlobalAdmin, createAdminRouter({ repos }));
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://localhost:${server.address().port}`, repos, adminToken, normalToken, orgA, orgB };
}

function cookies(token) { return { headers: { 'Content-Type': 'application/json', Cookie: `eh_session=${token}` } }; }
async function req(base, method, pathname, token, body) {
  const opts = cookies(token);
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${pathname}`, { method, ...opts });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('non-admin cannot manage devices in the global panel', async () => {
  const { server, base, normalToken } = await startServer();
  try {
    const list = await req(base, 'GET', '/api/admin/devices', normalToken);
    assert.equal(list.status, 403);
  } finally { server.close(); }
});

test('global admin lists ALL devices across teams (with team name)', async () => {
  const { server, base, adminToken } = await startServer();
  try {
    const list = await req(base, 'GET', '/api/admin/devices', adminToken);
    assert.equal(list.status, 200);
    assert.equal(list.data.devices.length, 2);
    const a = list.data.devices.find((d) => d.uuid === 'CHIP-A');
    assert.equal(a.orgName, 'Team A');
    assert.equal(a.deviceName, 'Kart A');
    const b = list.data.devices.find((d) => d.uuid === 'CHIP-B');
    assert.equal(b.orgName, 'Team B');

    // Filter by org.
    const filtered = await req(base, 'GET', `/api/admin/devices?orgId=${list.data.devices[0].orgId}`, adminToken);
    assert.equal(filtered.data.devices.length, 1);
  } finally { server.close(); }
});

test('global admin revokes a device from any team and it disappears', async () => {
  const { server, base, adminToken, repos, orgA } = await startServer();
  try {
    const list = await req(base, 'GET', '/api/admin/devices', adminToken);
    const chipA = list.data.devices.find((d) => d.uuid === 'CHIP-A');
    assert.ok(chipA);

    const del = await req(base, 'DELETE', `/api/admin/devices/${chipA.id}`, adminToken);
    assert.equal(del.status, 200);

    assert.equal(await repos.getEsp32Device(chipA.id), null, 'device row gone');
    const rest = await req(base, 'GET', '/api/admin/devices', adminToken);
    assert.equal(rest.data.devices.length, 1);
    assert.equal(rest.data.devices[0].uuid, 'CHIP-B');
  } finally { server.close(); }
});

test('global admin regenerates a team provisioning password (plain once, hash stored)', async () => {
  const { server, base, adminToken, repos, orgA } = await startServer();
  try {
    const regen = await req(base, 'POST', `/api/admin/orgs/${orgA.id}/device-password`, adminToken);
    assert.equal(regen.status, 200);
    assert.ok(regen.data.password, 'plain password shown once');
    assert.ok(regen.data.generatedAt);

    const updated = await repos.getOrganizationById(orgA.id);
    assert.ok(updated.devicePasswordHash);
    assert.equal(verifyTeamPassword(regen.data.password, updated.devicePasswordHash), true);
    assert.notEqual(updated.devicePasswordHash, regen.data.password);
  } finally { server.close(); }
});