import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { httpConfig, applyConfigPatch } from './config.js';
import { RaceSessionManager } from './src/raceSessionManager.js';
import { WsHub } from './src/wsHub.js';
import { fetchDriverDetails, listSessions, resolveCircuit } from './src/apexApi.js';
import { loadSettings, saveSettings } from './src/settingsStore.js';
import { initDatabase } from './src/db/client.js';
import { makeRepos } from './src/db/repos.js';
import { makeGoogleVerifier } from './src/auth/google.js';
import { makeSessionService } from './src/auth/session.js';
import { makeAuthMiddleware } from './src/auth/middleware.js';
import { createAuthRouter } from './src/auth/routes.js';
import { createWsAuthorizer } from './src/auth/wsAuthorizer.js';
import { makeLicenseService, makeLicenseMiddleware, isLicenseActive } from './src/billing/license.js';
import { makeBillingService } from './src/billing/billingService.js';
import { createBillingRouter } from './src/billing/routes.js';
import { createStripeWebhookRouter } from './src/billing/webhookRoutes.js';
import { createRaceConfigsRouter } from './src/raceConfigs/routes.js';
import { createRaceSessionsRouter } from './src/raceSessions/routes.js';
import { recoverRunningSessions } from './src/recovery.js';
import { createAccountRouter } from './src/account/routes.js';
import { createOrganizationsRouter } from './src/organizations/routes.js';
import { createMembersRouter } from './src/organizations/membersRoutes.js';
import { createAdminRouter } from './src/admin/routes.js';
import { createDevRouter } from './src/dev/routes.js';
import { createEsp32Router, createEsp32AdminRouter } from './src/esp32/routes.js';
import { tryEsp32Upgrade } from './src/esp32/ws.js';
import { createCommandRoutes } from './src/esp32/commandRoutes.js';
import { createCommandScheduler } from './src/esp32/commandScheduler.js';
import { requestContext, corsWhitelist, rateLimit, asyncHandler, notFound, errorHandler } from './src/server/middleware.js';
import { logger } from './src/utils/logger.js';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
server.setMaxListeners(20);
const wss = new WebSocketServer({ server });
const hub = new WsHub(wss);
const manager = new RaceSessionManager();

// Clients that don't send a session id operate on this session. The frontend
// is still single-session (Fase 0 keeps it working unchanged); Fase 5+ adds
// real session selection via the race_sessions UI.
const DEFAULT_SESSION_ID = 'default';

// Populated at boot when PostgreSQL is configured: [requireAuth,
// requireActiveLicense]. Legacy mode (no DB) keeps sessions endpoints open.
let protect = [];
// Set when auth is enabled: WS handshake authorizer (auth + license).
let wsAuth = null;
// Set when the DB is configured: repo access for the InLap Box (ESP32) WS
// validation + registration flows.
let repos = null;

// Runs the current `protect` chain at REQUEST time (routes are registered
// before `protect` is populated at boot).
function useProtect(req, res, next) {
  if (!protect.length) return next();
  let i = 0;
  const step = (err) => {
    if (err) return next(err);
    if (i >= protect.length) return next();
    protect[i++](req, res, step);
  };
  step();
}

// Request context (requestId + structured access log) + CORS whitelist
// (spec 32: no more Access-Control-Allow-Origin: *).
app.use(requestContext);
app.use(corsWhitelist());

// Stripe webhooks need the RAW body for signature verification, so parse it
// BEFORE the global express.json() middleware.
app.use('/api/webhooks/stripe', express.raw({ type: '*/*' }));

app.use(express.json());
app.use(cookieParser());

// In production, serve the compiled React frontend (frontend/dist). In dev, the
// frontend runs on Vite and talks to this API via a proxy.
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
}

// Resolve which race session a request targets. Session id comes from the query
// string or the x-session-id header; it defaults to the legacy session so the
// current single-session frontend keeps working untouched.
function resolveRuntime(req, res) {
  const id =
    (req.query && req.query.sessionId) ||
    (req.headers && req.headers['x-session-id']) ||
    DEFAULT_SESSION_ID;
  const runtime = manager.getSession(id);
  if (!runtime) {
    res.status(404).json({ error: 'race_session_not_found', message: `No race session '${id}'` });
    return null;
  }
  return runtime;
}

// ---- Race sessions (Fase 0 multi-session management). When auth is enabled
// these are protected (requireAuth + requireActiveLicense -> 402). ----
app.get('/api/sessions', useProtect, (req, res) => {
  res.json({ sessions: manager.list() });
});

app.post('/api/sessions', useProtect, (req, res) => {
  const b = req.body || {};
  const id = b.id || crypto.randomUUID();
  if (manager.hasSession(id)) {
    return res.status(409).json({ error: 'conflict', message: `Race session '${id}' already exists` });
  }
  const config = loadSettings(); // start from persisted (legacy) settings
  applyConfigPatch(config, b.config || {});
  manager.createSession({ raceSessionId: id, orgId: req.user?.orgId || 'local', config, hub });
  res.json({ ok: true, session: manager.list().find((s) => s.id === id) });
});

app.get('/api/sessions/:id', useProtect, (req, res) => {
  const rt = manager.getSession(req.params.id);
  if (!rt) return res.status(404).json({ error: 'race_session_not_found' });
  const info = manager.list().find((s) => s.id === req.params.id);
  res.json(info);
});

app.delete('/api/sessions/:id', useProtect, async (req, res) => {
  if (!(await manager.removeSession(req.params.id))) {
    return res.status(404).json({ error: 'race_session_not_found' });
  }
  res.json({ ok: true });
});

app.get('/api/sessions/:id/state', useProtect, (req, res) => {
  const rt = manager.getSession(req.params.id);
  if (!rt) return res.status(404).json({ error: 'race_session_not_found' });
  res.json(rt.getSnapshot());
});

// ---- State ----
app.get('/api/state', (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  res.json(rt.getSnapshot());
});

// Legacy: list archived sessions from the Apex backend (not used by the UI).
app.get('/api/apex/sessions', async (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  try {
    res.json({ sessions: await listSessions(rt.config.apex) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/driver/:id', async (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  try {
    const details = await fetchDriverDetails(req.params.id, { laps: 40, pits: true, best: true, infos: true }, rt.config.apex);
    rt.strategyEngine.setDriverDetails(req.params.id, details);
    res.json(details);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Setup status ----
app.get('/api/setup-status', (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  const c = rt.config;
  res.json({
    complete: c.race.setupDone === true,
    circuitUrl: c.apex.circuitUrl,
    teamName: c.race.ourTeamName || '',
    ourKart: c.race.ourKart,
  });
});

app.post('/api/setup', rateLimit({ windowMs: 60000, max: 20, name: 'setup' }), asyncHandler(async (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  const b = req.body || {};
  applyConfigPatch(rt.config, b);
  if (b.circuitUrl) {
    try {
      const cfg = await resolveCircuit(String(b.circuitUrl).trim());
      Object.assign(rt.config.apex, cfg);
      console.log(`[setup:${rt.raceSessionId}] Circuit ${cfg.circuitUrl} -> ${cfg.host}:${cfg.basePort}`);
    } catch (e) {
      return res.status(502).json({ error: `circuit: ${e.message}` });
    }
  }
  rt.config.race.setupDone = true;
  console.log(`[setup:${rt.raceSessionId}] Completed for team "${rt.config.race.ourTeamName}" (kart ${rt.config.race.ourKart})`);
  if (rt.orgId === 'local') saveSettings(rt.config); // legacy session only
  rt.strategyEngine.reset();
  rt.apexClient.connect();
  res.json({ ok: true, config: rt.config });
}));

app.post('/api/config', (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  applyConfigPatch(rt.config, req.body || {});
  if (rt.orgId === 'local') saveSettings(rt.config); // legacy session only
  // Configuration changes affect the live strategy immediately. Push a fresh
  // snapshot so controls such as the manual pilot selector update at once.
  rt.broadcast();
  res.json(rt.config);
});

app.get('/api/config', (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  res.json(rt.config);
});

// ---- Offline mode (test with saved state) ----
app.post('/api/offline', (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  const { enabled } = req.body || {};
  rt.offlineMode = !!enabled;
  console.log(`[offline:${rt.raceSessionId}] mode ${rt.offlineMode ? 'ON (saved state)' : 'OFF (live)'}`);
  rt.broadcast();
  res.json({ offline: rt.offlineMode, savedAt: rt.stateStore.get()?.savedAt || null });
});

// ---- Circuit selection ----
app.get('/api/circuit', (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  res.json({
    circuitUrl: rt.config.apex.circuitUrl,
    host: rt.config.apex.host,
    basePort: rt.config.apex.basePort,
    wssPort: rt.config.apex.wssPort,
    requestUrl: rt.config.apex.requestUrl,
    track: rt.apexClient.getState().track,
  });
});

app.post('/api/circuit', async (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const cfg = await resolveCircuit(url);
    Object.assign(rt.config.apex, cfg);
    console.log(`[circuit:${rt.raceSessionId}] Switching to ${cfg.circuitUrl} -> ${cfg.host}:${cfg.basePort}`);
    rt.strategyEngine.reset();
    rt.apexClient.switchCircuit();
    res.json({ ok: true, ...cfg });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Qualifying capture & analysis ----
app.get('/api/qualy', (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  res.json(rt.qualyStore.get() || { saved: false, drivers: [] });
});

app.post('/api/qualy', (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  const snapshot = rt.strategyEngine.captureQualy(rt.apexClient.getState());
  rt.qualyStore.save(snapshot);
  console.log(`[qualy:${rt.raceSessionId}] Captured ${snapshot.drivers.length} drivers`);
  rt.broadcast();
  res.json({ ok: true, ...snapshot });
});

app.delete('/api/qualy', (req, res) => {
  const rt = resolveRuntime(req, res);
  if (!rt) return;
  rt.qualyStore.clear();
  rt.broadcast();
  res.json({ ok: true });
});

// ---- WebSocket: authenticate + validate license, then join the room ----
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const id = url.searchParams.get('raceSessionId') || DEFAULT_SESSION_ID;

  // InLap Box (ESP32): authenticate with a Bearer JWT and join the TEAM's room
  // (esp32:<orgId>) instead of a race session — a box may be online before any
  // race session has been created. Invalid/expired token or revoked device = reject.
  if (await tryEsp32Upgrade({ ws, req, repos, hub })) return;

  const rt = manager.getSession(id);
  if (!rt) {
    ws.close(4004, 'unknown race session');
    return;
  }
  // When auth is enabled, the handshake must authenticate + validate license
  // BEFORE the client can join the race room (spec section 17).
  if (wsAuth) {
    const ctx = await wsAuth(req);
    if (!ctx.ok) {
      ws.close(ctx.code, ctx.error);
      return;
    }
    ws._ctx = { orgId: ctx.orgId, sessionId: id };
  }
  hub.joinRoom(ws, `race:${id}`);
  ws.send(JSON.stringify({ type: 'state', data: rt.getSnapshot() }));
});

// ---- Boot: connect PostgreSQL (if configured) and wire auth + licenses.
// Without a database the app keeps working in legacy single-tenant mode and
// every auth request returns 503. ----
const dbCtx = await initDatabase();

let requireAuth = null;
if (dbCtx) {
  repos = makeRepos(dbCtx.db);
  const scheduler = createCommandScheduler({ repos, hub, manager });
  const sessionService = makeSessionService(repos);
  const licenseService = makeLicenseService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });
  const licenseMw = makeLicenseMiddleware({ licenseService });
  requireAuth = authMw.requireAuth;

  // Protected race-session endpoints: requireAuth -> requireActiveLicense (402).
  protect = [authMw.requireAuth, licenseMw.requireActiveLicense];

  // InLap Box (ESP32): public registration + team device admin panel.
  app.use(
    '/api/esp32',
    createEsp32Router({
      repos,
      rateLimitMw: rateLimit({ windowMs: 60000, max: 20, name: 'esp32-register' }),
    })
  );
  const esp32TeamRouter = express.Router();
  esp32TeamRouter.use(authMw.requireAuth);
  esp32TeamRouter.use(authMw.authorizeOrg(['admin', 'owner']));
  esp32TeamRouter.use(createCommandRoutes({ repos, hub, scheduler }));
  esp32TeamRouter.use(createEsp32AdminRouter({ repos }));
  app.use('/api/team/esp32-devices', esp32TeamRouter);

  // WS handshake auth is only enforced when Google login is ACTUALLY
  // configured. With a DB but no GOOGLE_CLIENT_ID the app runs in legacy mode
  // (the "Entrar" button has no session cookie), so the WS must stay open.
  let googleVerifier;
  try {
    googleVerifier = makeGoogleVerifier({ clientId: process.env.GOOGLE_CLIENT_ID });
  } catch (_) {
    googleVerifier = null;
  }
  if (googleVerifier) {
    wsAuth = createWsAuthorizer({ repos, sessionService, licenseService });
  }
  app.use(
    '/api/auth',
    createAuthRouter({
      repos,
      sessionService,
      verifyGoogleIdToken: googleVerifier || (async () => { throw new Error('not configured'); }),
      requireAuth: authMw.requireAuth,
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      loginRateLimit: rateLimit({ windowMs: 60000, max: 20, name: 'auth-google' }),
    })
  );

  // Account data management (RGPD, spec 36).
  app.use('/api/account', authMw.requireAuth, createAccountRouter({ repos }));

  // Organization onboarding + management (team name + pilots).
  app.use('/api/organizations', authMw.requireAuth, createOrganizationsRouter({ repos }));

  // Org-level team/member management (owner + org admin; global admins pass).
  app.use(
    '/api/organizations/me/members',
    authMw.requireAuth,
    authMw.authorizeOrg(['admin', 'owner']),
    createMembersRouter({ repos })
  );

  // GLOBAL admin panel — platform-wide user/org/membership/license management.
  app.use(
    '/api/admin',
    authMw.requireAuth,
    authMw.requireGlobalAdmin,
    rateLimit({ windowMs: 60000, max: 120, name: 'admin' }),
    createAdminRouter({ repos })
  );

  // Dev-only tooling (never in production): fake a license to test paid flows.
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/dev', authMw.requireAuth, createDevRouter({ repos }));
    console.log('[boot] DEV tools enabled: POST /api/dev/license { plan: "basic" | "pro" }');
  }

  // ---- Billing (Fase 4). Stripe configured via env; without keys the routes
  // return billing_not_configured (503). Checkout/portal only need auth. ----
  let stripe = null;
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    }
  } catch (_) {
    stripe = null;
  }
  const billingService = makeBillingService({
    stripe,
    repos,
    priceIds: {
      monthly: process.env.STRIPE_MONTHLY_PRICE_ID || '',
      annual: process.env.STRIPE_ANNUAL_PRICE_ID || '',
    },
    appUrl: process.env.APP_URL || `http://localhost:${httpConfig.port}`,
  });
  app.use('/api/billing', authMw.requireAuth, createBillingRouter({
    billingService,
    rateLimitMw: rateLimit({ windowMs: 60000, max: 10, name: 'billing' }),
  }));
  app.use(
    '/api/webhooks/stripe',
    createStripeWebhookRouter({
      stripe,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      billingService,
    })
  );

  // ---- Race configs + DB-backed sessions (Fase 5/6). ----
  const raceGuard = [authMw.requireAuth, licenseMw.requireActiveLicense];
  app.use('/api/race-configs', ...raceGuard, createRaceConfigsRouter({ repos }));
  app.use(
    '/api/race-sessions',
    ...raceGuard,
    createRaceSessionsRouter({ repos, manager, hub })
  );

  // Recover running races after a restart (spec 23); telemetry re-attached.
  await recoverRunningSessions({
    repos,
    manager,
    hub,
    connect: process.env.EH_RECONNECT !== 'false',
  }).catch((e) => console.error('[recover] failed:', e.message));

  await scheduler.start();

  // Hygiene: prune expired sessions daily.
  setInterval(() => { repos.deleteExpiredAuthSessions().catch(() => {}); }, 24 * 60 * 60 * 1000);

  // License enforcement on live connections (spec 17): if a license stops
  // being active while a client is connected, close it and stop sending data.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN || !ws._ctx) continue;
      licenseService
        .getForOrg(ws._ctx.orgId)
        .then((license) => {
          if (!isLicenseActive(license) && ws.readyState === ws.OPEN) {
            ws.close(4402, 'license_required');
          }
        })
        .catch(() => {});
    }
  }, 30 * 1000);
} else {
  app.use('/api/auth', (req, res) => {
    res.status(503).json({ error: 'database_required', message: 'Authentication requires PostgreSQL (set DATABASE_URL)' });
  });
}

const bootConfig = loadSettings();
manager.createSession({ raceSessionId: DEFAULT_SESSION_ID, orgId: 'local', config: bootConfig, hub });
console.log(`[boot] Default race session '${DEFAULT_SESSION_ID}' ready. Waiting for a circuit URL to connect.`);

// ---- Public health check + terminal middleware ----
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), db: dbCtx ? 'connected' : 'none' });
});

// 404 for unmatched /api/* routes, then the central error handler.
app.use(notFound);
app.use(errorHandler);

server.listen(httpConfig.port, httpConfig.host, () => {
  console.log(`Endurance Helper listening on http://${httpConfig.host}:${httpConfig.port}`);
});

process.on('SIGINT', async () => {
  await manager.stopAll();
  server.close(() => process.exit(0));
});
