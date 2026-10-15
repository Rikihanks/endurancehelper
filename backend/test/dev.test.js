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
import { createDevRouter } from '../src/dev/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function startDevServer() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });

  const user = await repos.createUser({ googleSub: 'sub-dev', email: 'd@x.com', name: 'D' });
  const org = await repos.createOrganization({ name: 'Dev Org', ownerUserId: user.id });
  await repos.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });
  const { token } = await sessionService.create(user.id);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/dev', authMw.requireAuth, createDevRouter({ repos }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://localhost:${server.address().port}`, repos, token, org };
}

test('dev license tool grants an annual license to the authed org', async () => {
  const { server, base, repos, token, org } = await startDevServer();
  try {
    const res = await fetch(`${base}/api/dev/license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `eh_session=${token}` },
      body: JSON.stringify({ interval: 'annual' }),
    });
    assert.equal(res.status, 200);
    const license = await repos.getLicenseByOrgId(org.id);
    assert.ok(license);
    assert.equal(license.plan, 'annual');
    assert.equal(license.status, 'active');
    assert.equal(license.seats, 5);
  } finally { server.close(); }
});

test('dev license tool switches billing interval and validates it', async () => {
  const { server, base, repos, token, org } = await startDevServer();
  try {
    const headers = { 'Content-Type': 'application/json', Cookie: `eh_session=${token}` };
    await fetch(`${base}/api/dev/license`, { method: 'POST', headers, body: JSON.stringify({ interval: 'monthly' }) });
    await fetch(`${base}/api/dev/license`, { method: 'POST', headers, body: JSON.stringify({ interval: 'annual' }) });

    const license = await repos.getLicenseByOrgId(org.id);
    assert.equal(license.plan, 'annual', 'switched to annual');
    assert.equal(license.seats, 5);

    const bad = await fetch(`${base}/api/dev/license`, { method: 'POST', headers, body: JSON.stringify({ interval: 'enterprise' }) });
    assert.equal(bad.status, 400);
  } finally { server.close(); }
});

test('dev license tool requires auth', async () => {
  const { server, base } = await startDevServer();
  try {
    const res = await fetch(`${base}/api/dev/license`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval: 'monthly' }) });
    assert.equal(res.status, 401);
  } finally { server.close(); }
});
