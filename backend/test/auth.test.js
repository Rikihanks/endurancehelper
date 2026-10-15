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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function startAuthServer({ verifier, googleClientId = 'test-client' }) {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    '/api/auth',
    createAuthRouter({
      repos,
      sessionService,
      verifyGoogleIdToken: verifier,
      requireAuth: authMw.requireAuth,
      googleClientId,
    })
  );
  app.use('/api/organizations', authMw.requireAuth, createOrganizationsRouter({ repos }));
  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once('listening', () => {
      resolve({ server, base: `http://localhost:${server.address().port}`, repos });
    });
  });
}

async function post(base, pathname, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${pathname}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

async function get(base, pathname, cookie) {
  const res = await fetch(`${base}${pathname}`, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function cookieValue(setCookie) {
  return setCookie ? setCookie.split(';')[0] : '';
}

test('google login creates user (no auto org) + sets an HttpOnly session cookie', async () => {
  const { server, base, repos } = await startAuthServer({
    verifier: async () => ({ sub: 'subA', email: 'a@x.com', name: 'Ana', picture: 'http://pic/a' }),
  });
  try {
    const login = await post(base, '/api/auth/google', { credential: 'tok' });
    assert.equal(login.status, 200);
    assert.ok(login.setCookie, 'Set-Cookie present');
    assert.match(login.setCookie, /HttpOnly/i);
    assert.match(login.setCookie, /SameSite=Lax/i);
    assert.ok(login.data.user.id);
    assert.equal(login.data.user.email, 'a@x.com');
    assert.equal(login.data.org, null, 'no org auto-created');
    assert.equal(login.data.onboardingRequired, true, 'onboarding is required');

    const user = await repos.findUserByGoogleSub('subA');
    assert.ok(user, 'user persisted by google_sub');
    assert.equal(await repos.getUserPrimaryOrg(user.id), null, 'still no membership');
  } finally {
    server.close();
  }
});

test('existing google_sub never duplicates the user (and no org is auto-created)', async () => {
  const { server, base, repos } = await startAuthServer({
    verifier: async () => ({ sub: 'subB', email: 'b@x.com', name: 'Bob', picture: '' }),
  });
  try {
    const first = await post(base, '/api/auth/google', { credential: 'tok1' });
    const second = await post(base, '/api/auth/google', { credential: 'tok2' });
    assert.equal(first.data.user.id, second.data.user.id, 'same user id');
    assert.equal(first.data.onboardingRequired, true);
    assert.equal(second.data.onboardingRequired, true);
    const memberships = await repos.listMembershipsByUser(first.data.user.id);
    assert.equal(memberships.length, 0, 'no membership before onboarding');
  } finally {
    server.close();
  }
});

test('requireAuth: /me without a session returns 401', async () => {
  const { server, base } = await startAuthServer({
    verifier: async () => ({ sub: 'subC', email: '', name: '', picture: '' }),
  });
  try {
    const me = await get(base, '/api/auth/me');
    assert.equal(me.status, 401);
    assert.equal(me.data.error, 'unauthenticated');
  } finally {
    server.close();
  }
});

test('requireAuth: /me with a valid cookie returns user + onboardingRequired', async () => {
  const { server, base } = await startAuthServer({
    verifier: async () => ({ sub: 'subD', email: 'd@x.com', name: 'Dana', picture: '' }),
  });
  try {
    const login = await post(base, '/api/auth/google', { credential: 'tok' });
    const cookie = cookieValue(login.setCookie);
    const me = await get(base, '/api/auth/me', cookie);
    assert.equal(me.status, 200);
    assert.equal(me.data.user.id, login.data.user.id);
    assert.equal(me.data.user.email, 'd@x.com');
    assert.equal(me.data.org, null);
    assert.equal(me.data.plan, null);
    assert.equal(me.data.onboardingRequired, true);
  } finally {
    server.close();
  }
});

test('logout revokes the session; /me then returns 401', async () => {
  const { server, base } = await startAuthServer({
    verifier: async () => ({ sub: 'subE', email: '', name: '', picture: '' }),
  });
  try {
    const login = await post(base, '/api/auth/google', { credential: 'tok' });
    const cookie = cookieValue(login.setCookie);

    const out = await post(base, '/api/auth/logout', {}, cookie);
    assert.equal(out.status, 200);

    const me = await get(base, '/api/auth/me', cookie);
    assert.equal(me.status, 401, 'session revoked server-side');
  } finally {
    server.close();
  }
});

test('invalid Google token returns 401 invalid_token', async () => {
  const { server, base } = await startAuthServer({
    verifier: async () => { throw new Error('bad signature'); },
  });
  try {
    const login = await post(base, '/api/auth/google', { credential: 'forged' });
    assert.equal(login.status, 401);
    assert.equal(login.data.error, 'invalid_token');
  } finally {
    server.close();
  }
});

test('two different users onboard and get two isolated orgs (multi-tenancy)', async () => {
  const profiles = { a: { sub: 'subX', email: 'x@x.com', name: 'X', picture: '' }, b: { sub: 'subY', email: 'y@y.com', name: 'Y', picture: '' } };
  const { server, base, repos } = await startAuthServer({ verifier: async (cred) => profiles[cred] });
  try {
    const ax = await post(base, '/api/auth/google', { credential: 'a' });
    const by = await post(base, '/api/auth/google', { credential: 'b' });
    assert.notEqual(ax.data.user.id, by.data.user.id);
    assert.equal(ax.data.onboardingRequired, true);

    // Onboarding creates each user's own org.
    const axCookie = cookieValue(ax.setCookie);
    const byCookie = cookieValue(by.setCookie);
    const onboardX = await post(base, '/api/organizations', { name: 'Team X', drivers: [{ name: 'P1' }] }, axCookie);
    const onboardY = await post(base, '/api/organizations', { name: 'Team Y', drivers: [{ name: 'P1' }] }, byCookie);
    assert.equal(onboardX.status, 200);
    assert.equal(onboardY.status, 200);
    assert.notEqual(onboardX.data.org.id, onboardY.data.org.id, 'each user gets their own org');

    // Cross-org access must be impossible at the data layer too.
    const aMemberships = await repos.listMembershipsByUser(ax.data.user.id);
    assert.equal(aMemberships.some((m) => m.orgId === onboardY.data.org.id), false);
  } finally {
    server.close();
  }
});

test('auth endpoints 503 when Google is not configured on the server', async () => {
  const { server, base } = await startAuthServer({
    verifier: async () => ({ sub: 's', email: '', name: '', picture: '' }),
    googleClientId: '',
  });
  try {
    const login = await post(base, '/api/auth/google', { credential: 'tok' });
    assert.equal(login.status, 503);
    assert.equal(login.data.error, 'google_auth_not_configured');
  } finally {
    server.close();
  }
});
