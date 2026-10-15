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
import { createMembersRouter } from '../src/organizations/membersRoutes.js';
import { errorHandler } from '../src/server/middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function startServer() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });

  const owner = await repos.createUser({ googleSub: 'o', email: 'owner@x.com', name: 'Owner' });
  const adminU = await repos.createUser({ googleSub: 'a', email: 'admin@x.com', name: 'Admin' });
  const plain = await repos.createUser({ googleSub: 'p', email: 'plain@x.com', name: 'Plain' });
  const toAdd = await repos.createUser({ googleSub: 'm', email: 'm@x.com', name: 'NewMember' });

  const org = await repos.createOrganization({ name: 'Team A', ownerUserId: owner.id });
  await repos.createMembership({ userId: owner.id, orgId: org.id, role: 'owner' });
  await repos.createMembership({ userId: adminU.id, orgId: org.id, role: 'admin' });
  await repos.createMembership({ userId: plain.id, orgId: org.id, role: 'member' });

  const { token: adminToken } = await sessionService.create(adminU.id);
  const { token: plainToken } = await sessionService.create(plain.id);
  const { token: ownerToken } = await sessionService.create(owner.id);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/organizations/me/members', authMw.requireAuth, authMw.authorizeOrg(['admin', 'owner']), createMembersRouter({ repos }));
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://localhost:${server.address().port}`, repos, org, adminToken, plainToken, ownerToken, owner, toAdd };
}

function cookies(token) { return { headers: { 'Content-Type': 'application/json', Cookie: `eh_session=${token}` } }; }
async function req(base, method, pathname, token, body) {
  const opts = cookies(token);
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${pathname}`, { method, ...opts });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('org admin lists members; a member is forbidden', async () => {
  const { server, base, adminToken, plainToken } = await startServer();
  try {
    const list = await req(base, 'GET', '/api/organizations/me/members', adminToken);
    assert.equal(list.status, 200);
    assert.equal(list.data.members.length, 3);
    assert.deepEqual(list.data.members.map((m) => m.role).sort(), ['admin', 'member', 'owner']);

    const denied = await req(base, 'GET', '/api/organizations/me/members', plainToken);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error, 'forbidden');
  } finally { server.close(); }
});

test('org admin adds member by email; duplicate and unknown email fail', async () => {
  const { server, base, adminToken, toAdd, repos, org } = await startServer();
  try {
    const add = await req(base, 'POST', '/api/organizations/me/members', adminToken, { email: 'm@x.com', role: 'admin' });
    assert.equal(add.status, 200);
    assert.equal(add.data.member.role, 'admin');
    assert.ok(await repos.findMembership(toAdd.id, org.id));

    const dup = await req(base, 'POST', '/api/organizations/me/members', adminToken, { email: 'm@x.com' });
    assert.equal(dup.status, 409);

    const unknown = await req(base, 'POST', '/api/organizations/me/members', adminToken, { email: 'nobody@x.com' });
    assert.equal(unknown.status, 404);
  } finally { server.close(); }
});

test('org admin cannot promote to owner; owner role/removal protected; owner can promote', async () => {
  const { server, base, adminToken, ownerToken, toAdd, repos, org } = await startServer();
  try {
    await req(base, 'POST', '/api/organizations/me/members', adminToken, { email: 'm@x.com', role: 'member' });

    const promoteOwner = await req(base, 'PUT', `/api/organizations/me/members/${toAdd.id}`, adminToken, { role: 'owner' });
    assert.equal(promoteOwner.status, 403, 'org admin cannot grant owner');

    const demote = await req(base, 'PUT', `/api/organizations/me/members/${toAdd.id}`, adminToken, { role: 'admin' });
    assert.equal(demote.status, 200);

    const touchOwner = await req(base, 'PUT', `/api/organizations/me/members/${org.ownerUserId}`, adminToken, { role: 'member' });
    assert.equal(touchOwner.status, 403, 'cannot change owner role');
    const removeOwner = await req(base, 'DELETE', `/api/organizations/me/members/${org.ownerUserId}`, adminToken);
    assert.equal(removeOwner.status, 403, 'cannot remove owner');

    // The owner CAN promote.
    const ownerPromotes = await req(base, 'PUT', `/api/organizations/me/members/${toAdd.id}`, ownerToken, { role: 'owner' });
    assert.equal(ownerPromotes.status, 200);
    assert.equal((await repos.findMembership(toAdd.id, org.id)).role, 'owner');
  } finally { server.close(); }
});

test('org admin removes a non-owner member', async () => {
  const { server, base, adminToken, toAdd, repos, org } = await startServer();
  try {
    await req(base, 'POST', '/api/organizations/me/members', adminToken, { email: 'm@x.com', role: 'member' });
    const del = await req(base, 'DELETE', `/api/organizations/me/members/${toAdd.id}`, adminToken);
    assert.equal(del.status, 200);
    assert.equal(await repos.findMembership(toAdd.id, org.id), null);
  } finally { server.close(); }
});

test('add/remove/role changes are recorded in the audit log', async () => {
  const { server, base, adminToken, toAdd, repos, org } = await startServer();
  try {
    await req(base, 'POST', '/api/organizations/me/members', adminToken, { email: 'm@x.com', role: 'member' });
    await req(base, 'PUT', `/api/organizations/me/members/${toAdd.id}`, adminToken, { role: 'admin' });
    await req(base, 'DELETE', `/api/organizations/me/members/${toAdd.id}`, adminToken);

    const logs = await repos.listAdminAuditLog({ orgId: org.id });
    const actions = logs.map((l) => l.action);
    assert.ok(actions.includes('create_membership'));
    assert.ok(actions.includes('change_role'));
    assert.ok(actions.includes('remove_membership'));
    assert.ok(logs.every((l) => l.scope === 'org'));
  } finally { server.close(); }
});

test('license seats cap the number of members (seats_limit)', async () => {
  const { server, base, adminToken, repos, org } = await startServer();
  try {
    // 3 members already exist; cap them at 3.
    await repos.createLicense({ orgId: org.id, plan: 'annual', seats: 3, status: 'active' });

    const blocked = await req(base, 'POST', '/api/organizations/me/members', adminToken, { email: 'm@x.com', role: 'member' });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error, 'seats_limit');

    // Increasing seats releases headroom.
    const lic = await repos.getLicenseByOrgId(org.id);
    await repos.updateLicenseById(lic.id, { seats: 5 });
    const ok = await req(base, 'POST', '/api/organizations/me/members', adminToken, { email: 'm@x.com', role: 'member' });
    assert.equal(ok.status, 200);
  } finally { server.close(); }
});

test('unauthenticated member management returns 401', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/api/organizations/me/members`);
    assert.equal(res.status, 401);
  } finally { server.close(); }
});
