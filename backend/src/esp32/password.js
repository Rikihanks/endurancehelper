// Team device-password hashing for InLap Box provisioning.
//
// The project has no existing password-hashing dependency (login is Google
// OAuth only), so this uses PBKDF2-SHA256 straight from node:crypto: no native
// modules, cryptographically sound, and the salt+work factor are embedded in the
// stored string so verification is self-describing and forward-compatible.
//
// Stored format: `pbkdf2$sha256$<iterations>$<salt b64url>$<hash b64url>`
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'sha256';
const ITERATIONS = 310000; // OWASP-recommended for PBKDF2-HMAC-SHA256
const KEY_LEN = 32;

// Readable random team password pilots type into the box's captive portal.
// 12 chars from a URL-safe alphabet (no ambiguous chars).
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function newTeamPassword() {
  let out = '';
  const bytes = randomBytes(12);
  for (let i = 0; i < 12; i += 1) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

export function hashTeamPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(String(password), salt, ITERATIONS, KEY_LEN, ALGO);
  return [
    'pbkdf2',
    ALGO,
    ITERATIONS,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export function verifyTeamPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = String(stored).split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const [, algo, iterStr, saltB64, hashB64] = parts;
  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64url');
    expected = Buffer.from(hashB64, 'base64url');
  } catch (_) {
    return false;
  }
  const actual = pbkdf2Sync(String(password), salt, iterations, expected.length || KEY_LEN, algo);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}