// Short-lived JWT for InLap Box (ESP32) authentication on the telemetry WS.
//
// The rest of the app authenticates browsers with revocable server-side
// sessions (HttpOnly cookie), but a bare ESP32 cannot hold a session — it needs
// a self-contained credential it can present on the WS upgrade as
// `Authorization: Bearer <token>`. We sign a compact HS256 JWT with the same
// JWT_SECRET the project already configures (see .env.example), payload:
//   { equipo_id: <orgId>, esp32_uuid: <chip uuid>, iat, exp }
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ESP32_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h, short by design

function secret() {
  return process.env.JWT_SECRET || 'inlap-dev-esp32-insecure-secret';
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlToJson(segment) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function sign(header, payload, key) {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${data}.${createHmac('sha256', key).update(data).digest('base64url')}`;
}

export function signEsp32Token({ orgId, esp32Uuid }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    equipo_id: orgId,
    esp32_uuid: esp32Uuid,
    iat: now,
    exp: now + ESP32_TOKEN_TTL_SECONDS,
  };
  return sign(header, payload, secret());
}

// Returns the verified payload or `null` (invalid signature, expired, malformed
// or wrong claims). Never throws.
export function verifyEsp32Token(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, sigSeg] = parts;

  const tight = `${headerSeg}.${payloadSeg}`;
  const expected = createHmac('sha256', secret()).update(tight).digest('base64url');
  const provided = Buffer.from(sigSeg, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    return null;
  }

  const header = b64urlToJson(headerSeg);
  const payload = b64urlToJson(payloadSeg);
  if (!header || header.alg !== 'HS256' || !payload) return null;
  if (!payload.equipo_id || !payload.esp32_uuid) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;

  return {
    orgId: payload.equipo_id,
    esp32Uuid: payload.esp32_uuid,
    exp: payload.exp,
  };
}

// Verify a JWT's signature but IGNORE expiry.
// Used by the WS handler to detect expired-but-valid tokens for auto-refresh.
// The ESP32 never calls this — the backend does it transparently.
export function verifyEsp32TokenIgnoreExpiry(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, sigSeg] = parts;

  const tight = `${headerSeg}.${payloadSeg}`;
  const expected = createHmac('sha256', secret()).update(tight).digest('base64url');
  const provided = Buffer.from(sigSeg, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    return null;
  }

  const header = b64urlToJson(headerSeg);
  const payload = b64urlToJson(payloadSeg);
  if (!header || header.alg !== 'HS256' || !payload) return null;
  if (!payload.equipo_id || !payload.esp32_uuid) return null;

  return {
    orgId: payload.equipo_id,
    esp32Uuid: payload.esp32_uuid,
  };
}

// Bearer header parser: "Authorization: Bearer <token>" -> token or null.
export function bearerToken(header = '') {
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}