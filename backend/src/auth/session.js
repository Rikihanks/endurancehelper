import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'eh_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

// Server-side, revocable sessions. The cookie carries an opaque token; only its
// SHA-256 hash is stored, so a DB leak does not expose usable sessions.
export function makeSessionService(repos) {
  return {
    async create(userId) {
      const token = newToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await repos.createAuthSession({ userId, tokenHash: hashToken(token), expiresAt });
      return { token, expiresAt };
    },

    async get(token) {
      if (!token) return null;
      const session = await repos.findAuthSessionByTokenHash(hashToken(token));
      if (!session) return null;
      if (session.expiresAt.getTime() < Date.now()) return null;
      return session;
    },

    async revoke(token) {
      if (!token) return false;
      return !!(await repos.revokeAuthSession(hashToken(token)));
    },
  };
}
