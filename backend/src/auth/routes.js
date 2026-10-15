import express from 'express';
import { SESSION_COOKIE } from './session.js';
import { asyncHandler } from '../server/middleware.js';

// Auth routes (spec section 13):
//   POST /api/auth/google   { credential } -> verify Google id_token, upsert
//                            user, ensure an org, set HttpOnly session cookie
//   POST /api/auth/logout                 -> revoke + clear the session cookie
//   GET  /api/auth/me                     -> current user (requireAuth)
//
// `verifyGoogleIdToken` and `requireAuth` are injected so tests can substitute
// a stub verifier and exercise the flow without real Google.
export function createAuthRouter({ repos, sessionService, verifyGoogleIdToken, requireAuth, googleClientId, loginRateLimit }) {
  const router = express.Router();
  const guard = loginRateLimit || ((req, res, next) => next());

  // Emails that should be GLOBAL admins (platform-wide), comma-separated in the
  // ADMIN_EMAILS env var. This is the out-of-band bootstrap path: admins are
  // never self-granted, so the first admins must come from here (or the
  // promote-admin script).
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  async function ensureAdminBootstrap(user) {
    if (adminEmails.includes((user.email || '').toLowerCase()) && user.role !== 'admin') {
      return repos.updateUser(user.id, { role: 'admin' });
    }
    return user;
  }

  router.post('/google', guard, asyncHandler(async (req, res) => {
    if (!googleClientId) {
      return res.status(503).json({ error: 'google_auth_not_configured', message: 'GOOGLE_CLIENT_ID is not set on the server' });
    }
    const credential = req.body?.credential;
    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ error: 'validation_error', message: 'credential is required' });
    }

    let profile;
    try {
      profile = await verifyGoogleIdToken(credential);
    } catch (_) {
      return res.status(401).json({ error: 'invalid_token', message: 'Google token could not be verified' });
    }

    // Upsert by google_sub (stable id) so an existing user never duplicates.
    let user = await repos.findUserByGoogleSub(profile.sub);
    if (user) {
      user = await repos.updateUser(user.id, {
        email: profile.email || user.email,
        name: profile.name || user.name,
        avatarUrl: profile.picture || user.avatarUrl,
        lastLoginAt: new Date(),
      });
    } else {
      user = await repos.createUser({
        googleSub: profile.sub,
        email: profile.email || null,
        name: profile.name || null,
        avatarUrl: profile.picture || null,
        lastLoginAt: new Date(),
      });
    }

    // The user is created/updated, but the ORGANIZATION is NOT auto-created:
    // onboarding (POST /api/organizations) asks the user for team name +
    // pilots. Until then /api/auth/me reports onboardingRequired.
    const primary = await repos.getUserPrimaryOrg(user.id);

    // Promote a matching email from ADMIN_EMAILS to global admin (bootstrap).
    user = await ensureAdminBootstrap(user);

    const { token, expiresAt } = await sessionService.create(user.id);
    const secure = process.env.NODE_ENV === 'production';
    // Lax by default (same-origin frontend+API = most secure). Only use 'none'
    // when the frontend is served from ANOTHER origin (e.g. Netlify) and HTTPS
    // is guaranteed — set COOKIE_SAME_SITE=none in production for that case.
    const sameSite = secure && process.env.COOKIE_SAME_SITE === 'none' ? 'none' : 'lax';
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, picture: user.avatarUrl, isAdmin: user.role === 'admin' },
      org: primary ? { id: primary.orgId, role: primary.role } : null,
      onboardingRequired: !primary,
      expiresAt,
    });
  }));

  router.post('/logout', async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await sessionService.revoke(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    let org = null;
    let plan = null;
    if (req.user.orgId) {
      const o = await repos.getOrganizationById(req.user.orgId);
      const lic = await repos.getLicenseByOrgId(req.user.orgId);
      org = o ? { id: o.id, name: o.name, role: req.user.role } : null;
      plan = lic ? lic.plan : null;
    }
    res.json({
      user: req.user,
      org,
      plan,
      onboardingRequired: !req.user.orgId,
      session: { expiresAt: req.session.expiresAt },
    });
  }));

  return router;
}
