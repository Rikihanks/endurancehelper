import { SESSION_COOKIE } from './session.js';
import { isLicenseActive } from '../billing/license.js';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch (_) {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

// WebSocket handshake authorization (spec section 17):
//   authenticate -> identify user -> resolve organization -> validate license
// A user without a valid license must not receive race data, even with a
// pre-existing connection. Returns { ok:true, userId, orgId, role } or
// { error, code } (4401 unauthorized / 4402 license required).
export function createWsAuthorizer({ repos, sessionService, licenseService }) {
  return async function resolveWsContext(req) {
    const token = parseCookies(req.headers?.cookie || '')[SESSION_COOKIE];
    const session = token ? await sessionService.get(token) : null;
    if (!session) return { error: 'unauthenticated', code: 4401 };

    const user = await repos.findUserById(session.userId);
    if (!user) return { error: 'unauthenticated', code: 4401 };

    const primary = await repos.getUserPrimaryOrg(user.id);
    if (!primary) return { error: 'unauthenticated', code: 4401 };

    const license = await repos.getLicenseByOrgId(primary.orgId);
    if (!isLicenseActive(license)) return { error: 'license_required', code: 4402 };

    return { ok: true, userId: user.id, orgId: primary.orgId, role: primary.role };
  };
}
