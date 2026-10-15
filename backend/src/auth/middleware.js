import { SESSION_COOKIE } from './session.js';

// Authentication + authorization middleware (spec section 13).
//
// Reads the HttpOnly session cookie, resolves the session + user + primary org,
// and sets req.user = { id, email, orgId, role, isAdmin, isActive }.
//  - `role`    = the membership role of the primary org (member|admin|owner)
//  - `isAdmin` = GLOBAL admin (users.role === 'admin') — a platform-wide
//                superset that can act on ANY org, regardless of membership.
//
// A deactivated user (users.isActive = false) is rejected here, which locks
// them out (their existing sessions become useless).
export function makeAuthMiddleware({ repos, sessionService }) {
  async function requireAuth(req, res, next) {
    const token = req.cookies?.[SESSION_COOKIE];
    const session = token ? await sessionService.get(token) : null;
    if (!session) {
      return res.status(401).json({ error: 'unauthenticated', message: 'Authentication required' });
    }
    const user = await repos.findUserById(session.userId);
    if (!user) {
      return res.status(401).json({ error: 'unauthenticated', message: 'Session user no longer exists' });
    }
    if (user.isActive === false) {
      // Locked out by a global admin (deactivate). Revoke the presented session
      // so a later re-login attempt travels through the same guard too.
      await repos.revokeAuthSession(session.tokenHash);
      return res.status(403).json({ error: 'forbidden', message: 'Account deactivated' });
    }
    const primary = await repos.getUserPrimaryOrg(user.id);
    req.user = {
      id: user.id,
      email: user.email || '',
      orgId: primary ? primary.orgId : null,
      role: primary ? primary.role : null,
      isAdmin: user.role === 'admin',
      isActive: user.isActive !== false,
    };
    req.session = { token, userId: user.id, expiresAt: session.expiresAt };
    next();
  }

  // Global admin only (platform-wide). Returns 403 otherwise.
  function requireGlobalAdmin(req, res, next) {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden', message: 'Global admin required' });
    }
    next();
  }

  // Org-scoped authorization. `roles` is the set of membership roles allowed at
  // the caller's own org; GLOBAL admins always pass (they are a superset).
  // orgId is always taken from the session — never from client input.
  function authorizeOrg(roles) {
    return (req, res, next) => {
      const allowed = Array.isArray(roles) ? roles : [];
      if (!req.user || !req.user.orgId) {
        return res.status(403).json({ error: 'forbidden', message: 'Organization required' });
      }
      if (req.user.isAdmin || allowed.includes(req.user.role)) return next();
      return res.status(403).json({ error: 'forbidden', message: 'Insufficient role' });
    };
  }

  return { requireAuth, requireGlobalAdmin, authorizeOrg };
}
