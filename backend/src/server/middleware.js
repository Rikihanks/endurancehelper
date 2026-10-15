import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { AppError, toErrorBody } from '../errors.js';

// Attach requestId + timing + structured request log with userId/orgId.
export function requestContext(req, res, next) {
  req.requestId = randomUUID();
  req.startTime = Date.now();
  res.on('finish', () => {
    const log = logger.child({ requestId: req.requestId, method: req.method, path: req.originalUrl });
    const ctx = {};
    if (req.user?.id) ctx.userId = req.user.id;
    if (req.user?.orgId) ctx.orgId = req.user.orgId;
    if (req.raceSessionId) ctx.raceSessionId = req.raceSessionId;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level](`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - req.startTime}ms`, ctx);
  });
  next();
}

// CORS with an env-based whitelist (spec section 32). `*` is gone: cookies are
// only allowed from authorized origins. Requests without an Origin (curl, same
// origin) pass through.
export function corsWhitelist({ origins = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean) } = {}) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    if (origins.includes(origin) || origins.includes('*')) {
      res.header('Access-Control-Allow-Origin', origins.includes('*') ? '*' : origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

// Simple in-memory fixed-window rate limiter keyed by IP (spec section 33).
// Applied only to sensitive endpoints — never to WebSockets or telemetry.
export function rateLimit({ windowMs = 60000, max = 100, name = 'limit' } = {}) {
  const buckets = new Map();
  const log = logger.child({ scope: `ratelimit:${name}` });
  setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));
    if (b.count > max) {
      log.warn(`rate limit exceeded on ${name}`, { ip: key });
      return res.status(429).json({ error: 'rate_limited', message: 'Too many requests, try again later' });
    }
    next();
  };
}

// Express 4 does not catch async rejections; wrap handlers with this.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// 404 for unmatched API routes.
export function notFound(req, res) {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'resource_not_found', message: `No route ${req.method} ${req.path}` });
  } else {
    res.status(404).send('Not Found');
  }
}

// Central error handler (spec section 38): AppError -> its status/code;
// anything else -> 500 without stack traces in production.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const log = logger.child({ requestId: req.requestId });
  if (err instanceof AppError) {
    log.warn(err.message, { code: err.code, status: err.status });
    return res.status(err.status).json(toErrorBody(err));
  }
  log.error('Unhandled error', { message: err?.message, stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack });
  res.status(500).json(toErrorBody(err));
}
