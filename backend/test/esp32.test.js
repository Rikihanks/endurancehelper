import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocket, WebSocketServer } from 'ws';
import { createMemDb } from './helpers/pgmem.js';
import { makeRepos } from '../src/db/repos.js';
import { makeSessionService } from '../src/auth/session.js';
import { makeAuthMiddleware } from '../src/auth/middleware.js';
import { createAuthRouter } from '../src/auth/routes.js';
import { createOrganizationsRouter } from '../src/organizations/routes.js';
import { createEsp32Router, createEsp32AdminRouter } from '../src/esp32/routes.js';
import { tryEsp32Upgrade } from '../src/esp32/ws.js';
import { signEsp32Token } from '../src/esp32/token.js';
import { hashTeamPassword, verifyTeamPassword } from '../src/esp32/password.js';
import { WsHub } from '../src/wsHub.js';
import { errorHandler } from '../src/server/middleware.js';

process.env.JWT_SECRET = 'test-secret-for-esp32';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function startServer() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });

  const user = await repos.createUser({ googleSub: 'esp32-owner', email: 'owner@x.com', name: 'Owner' });
  const { token } = await sessionService.create(user.id);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', createAuthRouter({
    repos, sessionService,
    verifyGoogleIdToken: async () => ({ sub: 'esp32-owner', email: 'owner@x.com', name: 'Owner', picture: '' }),
    requireAuth: authMw.requireAuth,
    googleClientId: 'c',
  }));
  app.use('/api/organizations', authMw.requireAuth, createOrganizationsRouter({ repos }));
  app.use('/api/esp32', createEsp32Router({
    repos,
    rateLimitMw: (req, res, next) => next(), // tests bypass rate limiting
  }));
  app.use('/api/team/esp32-devices', authMw.requireAuth, authMw.authorizeOrg(['admin', 'owner']), createEsp32AdminRouter({ repos }));
  app.use(errorHandler); // mirrors production server.js so appError -> JSON

  const server = app.listen(0);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const hub = new WsHub(wss);
  wss.on('connection', async (ws, req) => {
    if (await tryEsp32Upgrade({ ws, req, repos, hub })) return;
    ws.close(4004, 'unknown race session'); // browser path (not exercised here)
  });

  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  return {
    server,
    wss,
    base: `http://localhost:${port}`,
    wsBase: `ws://localhost:${port}/ws`,
    repos,
    token,
  };
}

function authed(token) { return { headers: { 'Content-Type': 'application/json', Cookie: `eh_session=${token}` } }; }
async function req(base, method, pathname, token, body) {
  const opts = authed(token);
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${pathname}`, { method, ...opts });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function onboardTeam(base, token, name = 'Team ESP32') {
  const res = await req(base, 'POST', '/api/organizations', token, { name, drivers: [{ name: 'P1', weightKg: 75, ballastKg: 0, category: 'avg' }] });
  assert.equal(res.status, 200);
  return res.data.org.id;
}

function wsConnect(url, options) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    const timeout = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('ws open timeout')); }, 2000);
    const messages = [];
    let opened = false;
    const closedDeferred = {};
    closedDeferred.promise = new Promise((res) => { closedDeferred.resolve = res; });
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      const result = { code: String(code), reason: reason.toString() };
      closedDeferred.resolve(result);
      if (!opened) resolve({ ws, messages, waitFor: () => Promise.resolve(null), closed: closedDeferred.promise, closedEarly: result });
    });
    ws.on('open', () => {
      opened = true;
      clearTimeout(timeout);
      resolve({
        ws,
        messages,
        waitFor: (pred) => new Promise((res) => {
          const check = () => {
            const m = messages.find(pred);
            if (m) return res(m);
            setTimeout(check, 5);
          };
          check();
        }),
        closed: closedDeferred.promise,
      });
    });
    ws.on('error', () => {});
  });
}

test('password hashing round-trips and rejects wrong values', () => {
  const h = hashTeamPassword('s3cret-password');
  assert.match(h, /^pbkdf2\$sha256\$310000\$/);
  assert.equal(verifyTeamPassword('s3cret-password', h), true);
  assert.equal(verifyTeamPassword('wrong', h), false);
  assert.equal(verifyTeamPassword('s3cret-password', null), false);
  assert.equal(verifyTeamPassword('s3cret-password', 'garbage'), false);
});

test('register returns 401 when no team has a device password configured', async () => {
  const { server, base, token } = await startServer();
  try {
    await onboardTeam(base, token, 'Equipo Sin Password');
    const res = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'UUID-1', team_password: 'nope', device_name: 'Kart 1' });
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'unauthorized');
  } finally { server.close(); }
});

test('register validates required fields', async () => {
  const { server, base } = await startServer();
  try {
    const missing = await req(base, 'POST', '/api/esp32/register', null, { team_password: 'x' });
    assert.equal(missing.status, 400);
    const noPass = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'U' });
    assert.equal(noPass.status, 400);
  } finally { server.close(); }
});

test('team password lifecycle: generate once, regenerate, register devices', async () => {
  const { server, base, repos, token } = await startServer();
  try {
    const orgId = await onboardTeam(base, token, 'Team Box');

    // GET /password generates it the first time (plain, ONCE)...
    const first = await req(base, 'GET', '/api/team/esp32-devices/password', token);
    assert.equal(first.status, 200);
    assert.equal(first.data.firstTime, true);
    assert.ok(first.data.password, 'returns the plain password the first time');
    assert.ok(first.data.generatedAt);

    const storedOrg = await repos.getOrganizationById(orgId);
    assert.ok(storedOrg.devicePasswordHash, 'only the hash is stored');
    assert.ok(verifyTeamPassword(first.data.password, storedOrg.devicePasswordHash));
    assert.notEqual(storedOrg.devicePasswordHash, first.data.password, 'hash != plain');

    // ...and afterwards just reports it exists (no plain text, no regeneration).
    const second = await req(base, 'GET', '/api/team/esp32-devices/password', token);
    assert.equal(second.status, 200);
    assert.equal(second.data.firstTime, false);
    assert.equal(second.data.configured, true);
    assert.equal(second.data.password, null, 'never shown in clear again');

    // Register a device with the correct password -> 200 + token.
    const reg = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'CHIP-0001', team_password: first.data.password, device_name: 'Kart 3' });
    assert.equal(reg.status, 200);
    assert.ok(reg.data.token, 'returns a JWT');

    // Re-registering the same uuid updates the name instead of duplicating.
    const reg2 = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'CHIP-0001', team_password: first.data.password, device_name: 'Kart 9' });
    assert.equal(reg2.status, 200);
    const devices = await repos.listEsp32Devices(orgId);
    assert.equal(devices.length, 1, 'no duplicate rows for the same chip');
    assert.equal(devices[0].deviceName, 'Kart 9');

    // Wrong password -> 401 even when a valid one also exists.
    const bad = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'CHIP-9999', team_password: 'totally-wrong', device_name: 'X' });
    assert.equal(bad.status, 401);

    // Regenerating invalidates the OLD password for NEW devices only.
    const regen = await req(base, 'POST', '/api/team/esp32-devices/regenerate-password', token);
    assert.equal(regen.status, 200);
    assert.ok(regen.data.password);
    assert.notEqual(regen.data.password, first.data.password);

    const oldPass = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'CHIP-0002', team_password: first.data.password, device_name: 'Old' });
    assert.equal(oldPass.status, 401, 'old password no longer works');

    const newPass = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'CHIP-0002', team_password: regen.data.password, device_name: 'Kart 2' });
    assert.equal(newPass.status, 200, 'new password works');
    const devices2 = await repos.listEsp32Devices(orgId);
    assert.equal(devices2.length, 2);

    // Admin list shows the devices with dates.
    const list = await req(base, 'GET', '/api/team/esp32-devices', token);
    assert.equal(list.status, 200);
    assert.equal(list.data.devices.length, 2);
    const chip1 = list.data.devices.find((d) => d.uuid === 'CHIP-0001');
    assert.equal(chip1.deviceName, 'Kart 9');
    assert.ok(chip1.registeredAt);
  } finally { server.close(); }
});

test('admin deletion revokes a device (WS rejects its old token)', async () => {
  const { server, base, repos, token } = await startServer();
  try {
    const orgId = await onboardTeam(base, token, 'Team Revoke');
    const pwd = await req(base, 'GET', '/api/team/esp32-devices/password', token);
    const reg = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'CHIP-A', team_password: pwd.data.password, device_name: 'Kart A' });
    const jwt = reg.data.token;

    // Valid token + approved device -> connects and joins the org room.
    const conn = await wsConnect(`${base.replace('http', 'ws')}/ws`, { headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } });
    const ack = await conn.waitFor((m) => m.type === 'connected');
    assert.equal(ack.ok, true, 'receives the connected ack');
    conn.ws.close();
    await conn.closed;

    // Sanity: device last_connection was updated after connecting.
    const dev = await repos.getEsp32DeviceByOrgAndUuid(orgId, 'CHIP-A');
    assert.ok(dev.lastConnectionAt, 'última conexión updated on WS connect');

    // Admin deletes/revokes the device.
    const list = await req(base, 'GET', '/api/team/esp32-devices', token);
    const devId = list.data.devices.find((d) => d.uuid === 'CHIP-A').id;
    const del = await req(base, 'DELETE', `/api/team/esp32-devices/${devId}`, token);
    assert.equal(del.status, 200);

    // Same old token is now rejected on the WS upgrade.
    const rejected = await wsConnect(`${base.replace('http', 'ws')}/ws`, { headers: { Authorization: `Bearer ${jwt}` } });
    const closed2 = await rejected.closed;
    assert.equal(closed2.code, '4403', 'revoked device closed with 4403');
  } finally { server.close(); }
});

test('WS rejects forged/expired tokens', async () => {
  const { server, base, token } = await startServer();
  try {
    const orgId = await onboardTeam(base, token, 'Team Forge');
    const pwd = await req(base, 'GET', '/api/team/esp32-devices/password', token);

    // Tampered token (signature mismatch / payload change).
    const [h, p, s] = signEsp32Token({ orgId, esp32Uuid: 'CHIP-F' }).split('.');
    const forged1 = await wsConnect(`${base.replace('http', 'ws')}/ws`, { headers: { Authorization: `Bearer ${h}.${p}.AAAA` } });
    const c1 = await forged1.closed;
    assert.equal(c1.code, '4401');

    const forged2 = await wsConnect(`${base.replace('http', 'ws')}/ws`, { headers: { Authorization: `Bearer a.b.c` } });
    const c2 = await forged2.closed;
    assert.equal(c2.code, '4401');

    // No token at all -> treated as a browser client (unknown race session here).
    const noToken = await wsConnect(`${base.replace('http', 'ws')}/ws`);
    const c3 = await noToken.closed;
    assert.equal(c3.code, '4004', 'no bearer header means browser flow');
  } finally { server.close(); }
});

test('a device cannot register to a second team (uuid is unique)', async () => {
  const { server, base, repos, token } = await startServer();
  try {
    // Second user in the SAME platform database -> second team.
    const userB = await repos.createUser({ googleSub: 'esp32-owner-b', email: 'b@x.com', name: 'B' });
    const sessionService = makeSessionService(repos);
    const { token: tokenB } = await sessionService.create(userB.id);

    // Both teams onboarded and generate their own device password.
    const orgA = await onboardTeam(base, token, 'Team A');
    const orgB = await onboardTeam(base, tokenB, 'Team B');
    const pwdA = await req(base, 'GET', '/api/team/esp32-devices/password', token);
    assert.equal(pwdA.status, 200);
    const pwdB = await req(base, 'GET', '/api/team/esp32-devices/password', tokenB);
    assert.equal(pwdB.status, 200);
    assert.notEqual(pwdA.data.password, pwdB.data.password, 'two distinct teams -> distinct passwords');

    // Register the chip on team A.
    const regA = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'CHIP-SHARED', team_password: pwdA.data.password, device_name: 'A' });
    assert.equal(regA.status, 200);

    // Same chip with team B's password -> conflict, not a silent re-assignment.
    const regB = await req(base, 'POST', '/api/esp32/register', null, { uuid: 'CHIP-SHARED', team_password: pwdB.data.password, device_name: 'B' });
    assert.equal(regB.status, 409);
    assert.equal(regB.data.error, 'conflict');

    // Team A still owns it.
    const listA = await req(base, 'GET', '/api/team/esp32-devices', token);
    assert.equal(listA.data.devices.length, 1);
    assert.equal(listA.data.devices[0].orgId === undefined, true, 'orgId not leaked to the admin list');
    assert.equal(listA.data.devices[0].uuid, 'CHIP-SHARED');
  } finally { server.close(); }
});

test('admin endpoints require an authenticated session', async () => {
  const { server, base } = await startServer();
  try {
    const list = await req(base, 'GET', '/api/team/esp32-devices', null);
    assert.equal(list.status, 401, 'no session -> unauth');
    const pwd = await req(base, 'GET', '/api/team/esp32-devices/password', null);
    assert.equal(pwd.status, 401);
  } finally { server.close(); }
});