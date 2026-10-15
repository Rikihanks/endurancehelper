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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function startServer() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });

  const adminU = await repos.createUser({ googleSub: 'ga', email: 'ga@x.com', name: 'Global Admin', role: 'admin' });
  const norm = await repos.createUser({ googleSub: 'nu', email: 'norm@x.com', name: 'Normal' });
  const target = await repos.createUser({ googleSub: 'tu', email: 'target@x.com', name: 'Target' });

  const { token: adminToken } = await sessionService.create(adminU.id);
  const { token: normalToken } = await sessionService.create(norm.id);
  const { token: targetToken } = await sessionService.create(target.id);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/admin', authMw.requireAuth, authMw.requireGlobalAdmin, createAdminRouter({ repos }));
  app.use('/api/orgs/me', authMw.requireAuth, (req, res) => res.json({ role: req.user.role, isAdmin: req.user.isAdmin, orgId: req.user.orgId }));
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://localhost:${server.address().port}`, repos, adminToken, normalToken, targetToken, norm, target };
}

function cookies(token) { return { headers: { 'Content-Type': 'application/json', Cookie: `eh_session=${token}` } }; }
async function req(base, method, pathname, token, body) {
  const opts = cookies(token);
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${pathname}`, { method, ...opts });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('non-admin is forbidden from /api/admin', async () => {
  const { server, base, normalToken } = await startServer();
  try {
    const res = await req(base, 'GET', '/api/admin/users', normalToken);
    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'forbidden');
  } finally { server.close(); }
});

test('global admin lists users and promotes/demotes', async () => {
  const { server, base, adminToken, target, repos } = await startServer();
  try {
    const list = await req(base, 'GET', '/api/admin/users', adminToken);
    assert.equal(list.status, 200);
    assert.equal(list.data.users.length, 3);

    const promote = await req(base, 'POST', `/api/admin/users/${target.id}/promote`, adminToken);
    assert.equal(promote.status, 200);
    assert.equal((await repos.findUserById(target.id)).role, 'admin');

    const demote = await req(base, 'POST', `/api/admin/users/${target.id}/demote`, adminToken);
    assert.equal(demote.status, 200);
    assert.equal((await repos.findUserById(target.id)).role, 'user');
  } finally { server.close(); }
});

test('deactivate locks the user out (sessions rejected); activate restores', async () => {
  const { server, base, adminToken, targetToken, target, repos } = await startServer();
  try {
    // sanity: target can authenticate before deactivation
    const before = await req(base, 'GET', '/api/orgs/me', targetToken);
    assert.equal(before.status, 200);

    await req(base, 'POST', `/api/admin/users/${target.id}/deactivate`, adminToken);
    assert.equal((await repos.findUserById(target.id)).isActive, false);

    // Deactivated => sessions revoked, so the user can no longer authenticate.
    const after = await req(base, 'GET', '/api/orgs/me', targetToken);
    assert.ok([401, 403].includes(after.status), `expected 401/403, got ${after.status}`);

    // Global admin can still manage the org.
    await req(base, 'POST', `/api/admin/users/${target.id}/activate`, adminToken);
    assert.equal((await repos.findUserById(target.id)).isActive, true);
  } finally { server.close(); }
});

test('cannot deactivate or delete yourself', async () => {
  const { server, base, adminToken } = await startServer();
  try {
    const me = await req(base, 'GET', '/api/admin/users', adminToken);
    const meId = me.data.users.find((u) => u.role === 'admin').id;
    const demote = await req(base, 'POST', `/api/admin/users/${meId}/demote`, adminToken);
    assert.equal(demote.status, 403, 'cannot demote yourself');
    const deact = await req(base, 'POST', `/api/admin/users/${meId}/deactivate`, adminToken);
    assert.equal(deact.status, 403, 'cannot deactivate yourself');
  } finally { server.close(); }
});

test('delete a user who owns an org is blocked; org delete + license flows work', async () => {
  const { server, base, adminToken, norm, repos } = await startServer();
  try {
    // Admin creates an org owned by `norm`.
    const createOrg = await req(base, 'POST', '/api/admin/orgs', adminToken, { name: 'Team Norm', ownerEmail: 'norm@x.com' });
    assert.equal(createOrg.status, 200);
    const orgId = createOrg.data.org.id;

    // Cannot delete the owner directly (FK restrict).
    const blocked = await req(base, 'DELETE', `/api/admin/users/${norm.id}`, adminToken);
    assert.equal(blocked.status, 409);

    // Grant a license.
    const lic = await req(base, 'POST', `/api/admin/orgs/${orgId}/license`, adminToken, { plan: 'annual', seats: 5, status: 'active' });
    assert.equal(lic.status, 200);
    assert.equal(lic.data.license.plan, 'annual');
    assert.ok(await repos.getLicenseByOrgId(orgId));

    // Update the license.
    const upd = await req(base, 'PUT', `/api/admin/orgs/${orgId}/license`, adminToken, { seats: 8, status: 'trialing' });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.license.seats, 8);

    // Delete the org (cascades license + memberships) -> then the owner can go.
    const delOrg = await req(base, 'DELETE', `/api/admin/orgs/${orgId}`, adminToken);
    assert.equal(delOrg.status, 200);
    assert.equal(await repos.getOrganizationById(orgId), null);

    const delUser = await req(base, 'DELETE', `/api/admin/users/${norm.id}`, adminToken);
    assert.equal(delUser.status, 200);
    assert.equal(await repos.findUserById(norm.id), null);
  } finally { server.close(); }
});

test('global admin manages members of ANY org and transfers ownership', async () => {
  const { server, base, adminToken, norm, target, repos } = await startServer();
  try {
    const org = await repos.createOrganization({ name: 'Team Norm', ownerUserId: norm.id });
    await repos.createMembership({ userId: norm.id, orgId: org.id, role: 'owner' });

    const addMember = await req(base, 'POST', `/api/admin/orgs/${org.id}/members`, adminToken, { email: 'target@x.com', role: 'member' });
    assert.equal(addMember.status, 200);

    const promote = await req(base, 'PUT', `/api/admin/orgs/${org.id}/members/${target.id}`, adminToken, { role: 'owner' });
    assert.equal(promote.status, 200);

    // Global admin can remove the (previous) owner too.
    const removeOwner = await req(base, 'DELETE', `/api/admin/orgs/${org.id}/members/${norm.id}`, adminToken);
    assert.equal(removeOwner.status, 200);
    assert.equal(await repos.getOrganizationById(org.id).then((o) => o.ownerUserId), target.id);
  } finally { server.close(); }
});

test('admin creates a user by email; duplicates conflict', async () => {
  const { server, base, adminToken, repos } = await startServer();
  try {
    const create = await req(base, 'POST', '/api/admin/users', adminToken, { email: 'NEW@x.com', name: 'Newbie' });
    assert.equal(create.status, 200);
    assert.equal(create.data.user.email, 'new@x.com');
    const user = await repos.findUserByEmail('new@x.com');
    assert.ok(user);
    assert.match(user.googleSub, /^manual-/);

    const dup = await req(base, 'POST', '/api/admin/users', adminToken, { email: 'new@x.com' });
    assert.equal(dup.status, 409);

    const noEmail = await req(base, 'POST', '/api/admin/users', adminToken, { name: 'X' });
    assert.equal(noEmail.status, 400);
  } finally { server.close(); }
});

test('admin actions appear in the audit log', async () => {
  const { server, base, adminToken, target } = await startServer();
  try {
    await req(base, 'POST', `/api/admin/users/${target.id}/promote`, adminToken);
    const logs = await req(base, 'GET', '/api/admin/logs', adminToken);
    assert.equal(logs.status, 200);
    assert.ok(logs.data.logs.some((l) => l.action === 'promote' && l.targetId === target.id));
    assert.ok(logs.data.logs.every((l) => l.scope === 'global'));
  } finally { server.close(); }
});
