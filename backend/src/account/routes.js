import express from 'express';
import { appError, toErrorBody } from '../errors.js';

// Account data management (spec section 36). Personal data is minimised and
// identifiable; these endpoints let a user export or delete their account.
// Protected at mount time with requireAuth.
export function createAccountRouter({ repos }) {
  const router = express.Router();

  function handle(res, fn) {
    return fn()
      .then((data) => res.json(data))
      .catch((e) => res.status(e.status || 500).json(toErrorBody(e)));
  }

  // GET /api/account/export — export the user + the orgs they belong to.
  router.get('/export', (req, res) =>
    handle(res, async () => {
      const user = await repos.findUserById(req.user.id);
      const memberships = await repos.listMembershipsByUser(req.user.id);
      const orgs = [];
      for (const m of memberships) {
        const org = await repos.getOrganizationById(m.orgId);
        if (org) orgs.push({ id: org.id, name: org.name, role: m.role });
      }
      return {
        user: { id: user.id, email: user.email, name: user.name, picture: user.avatarUrl, createdAt: user.createdAt },
        organizations: orgs,
      };
    })
  );

  // DELETE /api/account — delete the account. A user who owns an organization
  // must transfer/delete it first (owner FK is RESTRICT); memberships are
  // removed by cascade.
  router.delete('/', (req, res) =>
    handle(res, async () => {
      const memberships = await repos.listMembershipsByUser(req.user.id);
      const ownedOrgs = [];
      for (const m of memberships) {
        const org = await repos.getOrganizationById(m.orgId);
        if (org && org.ownerUserId === req.user.id) ownedOrgs.push(org.id);
      }
      if (ownedOrgs.length) {
        throw appError('CONFLICT', 'Transfer or delete your organizations before deleting the account');
      }
      await repos.deleteUserById(req.user.id);
      return { ok: true };
    })
  );

  return router;
}
