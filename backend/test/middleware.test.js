import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { corsWhitelist, rateLimit, errorHandler, notFound, asyncHandler } from '../src/server/middleware.js';
import { appError } from '../src/errors.js';
import { createMemDb } from './helpers/pgmem.js';
import { makeRepos } from '../src/db/repos.js';
import { makeSessionService } from '../src/auth/session.js';
import { makeAuthMiddleware } from '../src/auth/middleware.js';
import { createAuthRouter } from '../src/auth/routes.js';
import { createAccountRouter } from '../src/account/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function startApp(setup) {
  const app = express();
  setup(app);
  app.use(notFound);
  app.use(errorHandler);
  const server = app.listen(0);
  return new Promise((resolve) => server.once('listening', () => resolve({ server, base: `http://localhost:${server.address().port}` })));
}

test('corsWhitelist allows authorized origins only (no more *)', async () => {
  const { server, base } = await startApp((app) => {
    app.use(corsWhitelist({ origins: ['https://app.test'] }));
    app.get('/api/ping', (req, res) => res.json({ ok: true }));
  });
  try {
    const ok = await fetch(`${base}/api/ping`, { headers: { Origin: 'https://app.test' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.test');
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');

    const denied = await fetch(`${base}/api/ping`, { headers: { Origin: 'https://evil.test' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null, 'unlisted origin gets no CORS headers');
  } finally { server.close(); }
});

test('rateLimit returns 429 once the window is exceeded', async () => {
  const { server, base } = await startApp((app) => {
    app.use(rateLimit({ windowMs: 60000, max: 3, name: 't' }));
    app.get('/api/x', (req, res) => res.json({ ok: true }));
  });
  try {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${base}/api/x`)).status);
    assert.deepEqual(codes, [200, 200, 200, 429]);
  } finally { server.close(); }
});

test('errorHandler maps AppError to its status + code', async () => {
  const { server, base } = await startApp((app) => {
    app.get('/api/forbidden', () => { throw appError('FORBIDDEN', 'nope'); });
  });
  try {
    const res = await fetch(`${base}/api/forbidden`);
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.deepEqual(body, { error: 'forbidden', message: 'nope' });
  } finally { server.close(); }
});

test('errorHandler hides internal details in production (no stack)', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { server, base } = await startApp((app) => {
      app.get('/api/sync', () => { throw new Error('secret detail'); });
      app.get('/api/async', asyncHandler(async () => { throw new Error('async secret'); }));
    });
    try {
      for (const p of ['sync', 'async']) {
        const res = await fetch(`${base}/api/${p}`);
        const body = await res.json();
        assert.equal(res.status, 500);
        assert.equal(body.error, 'internal_error');
        assert.equal(body.message, 'Internal server error');
        assert.ok(!JSON.stringify(body).includes('secret'), `${p} must not leak internals`);
      }
    } finally { server.close(); }
  } finally { process.env.NODE_ENV = original; }
});

test('notFound returns JSON 404 for unknown API routes', async () => {
  const { server, base } = await startApp((app) => {
    app.get('/api/ping', (req, res) => res.json({ ok: true }));
  });
  try {
    const res = await fetch(`${base}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'resource_not_found');
  } finally { server.close(); }
});

// ---- Account (RGPD) ----
async function startAccountServer() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });

  const user = await repos.createUser({ googleSub: 'sub-acct', email: 'acct@x.com', name: 'Acc' });
  const org = await repos.createOrganization({ name: 'Acc Org', ownerUserId: user.id });
  await repos.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });
  const { token } = await sessionService.create(user.id);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', createAuthRouter({
    repos, sessionService,
    verifyGoogleIdToken: async () => ({ sub: 'sub-acct', email: 'acct@x.com', name: 'Acc', picture: '' }),
    requireAuth: authMw.requireAuth,
    googleClientId: 'c',
  }));
  app.use('/api/account', authMw.requireAuth, createAccountRouter({ repos }));
  app.use(notFound);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://localhost:${server.address().port}`, repos, token };
}

test('account export returns the user + organizations', async () => {
  const { server, base, token } = await startAccountServer();
  try {
    const res = await fetch(`${base}/api/account/export`, { headers: { Cookie: `eh_session=${token}` } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.user.email, 'acct@x.com');
    assert.equal(body.organizations.length, 1);
    assert.equal(body.organizations[0].role, 'owner');
  } finally { server.close(); }
});

test('account delete is blocked for owners of organizations (conflict)', async () => {
  const { server, base, token } = await startAccountServer();
  try {
    const res = await fetch(`${base}/api/account`, { method: 'DELETE', headers: { Cookie: `eh_session=${token}` } });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.equal(body.error, 'conflict');
  } finally { server.close(); }
});
