import express from 'express';
import { appError, AppError } from '../errors.js';
import { asyncHandler } from '../server/middleware.js';
import { isLicenseActive } from '../billing/license.js';

// Org-level team/member management (owners + org admins; global admins pass too).
//
// Mounted at /api/organizations/me/members behind requireAuth + the
// authorizeOrg(['admin','owner']) guard — so the orgId ALWAYS comes from
// req.user.orgId (the session), never from client input.
const ALLOWED_ROLES = ['member', 'admin', 'owner'];
const safeRole = (r) => (ALLOWED_ROLES.includes(r) ? r : '');
const pick = (obj) => (obj ? { userId: obj.userId, role: obj.role, name: obj.name, email: obj.email, isActive: obj.isActive } : obj);

// Block adding a member once the org's active license seats are full.
async function assertSeatsAvailable(orgId, repos) {
  const license = await repos.getLicenseByOrgId(orgId);
  if (!license || !isLicenseActive(license)) return; // no active license -> no limit enforced
  const members = await repos.listMembershipsByOrg(orgId);
  if (members.length >= license.seats) {
    throw new AppError('seats_limit', 403, `License seat limit reached (${license.seats} seats)`);
  }
}

export function createMembersRouter({ repos, aw }) {
  const router = express.Router();
  const audit = (req, action, targetType, targetId, before, after) =>
    repos.createAdminAuditLog({
      actorUserId: req.user.id,
      scope: 'org',
      action,
      targetType,
      targetId,
      orgId: req.user.orgId,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
    });

  // GET / — list the current org's members.
  router.get('/', asyncHandler(async (req, res) => {
    const members = await repos.listMembersWithUser(req.user.orgId);
    res.json({ members: members.map(pick) });
  }));

  // POST / { email, role } — add a member by email.
  router.post('/', asyncHandler(async (req, res) => {
    const email = (req.body?.email || '').trim().toLowerCase();
    const role = safeRole(req.body?.role) || 'member';
    if (!email) throw appError('VALIDATION_ERROR', 'Email is required');
    if (!role) throw appError('VALIDATION_ERROR', 'Invalid role');
    // Only an owner (or a global admin) can grant owner.
    if (role === 'owner' && !req.user.isAdmin && req.user.role !== 'owner') {
      throw appError('FORBIDDEN', 'Only the owner can promote to owner');
    }

    await assertSeatsAvailable(req.user.orgId, repos);

    const user = await repos.findUserByEmail(email);
    if (!user) throw appError('RESOURCE_NOT_FOUND', 'No user with that email');
    const existing = await repos.findMembership(user.id, req.user.orgId);
    if (existing) throw appError('CONFLICT', 'User is already a member');

    const member = await repos.createMembership({ userId: user.id, orgId: req.user.orgId, role });
    await audit(req, 'create_membership', 'membership', user.id, null, { role });
    res.json({ member });
  }));

  // PUT /:userId { role } — change a member's role.
  router.put('/:userId', asyncHandler(async (req, res) => {
    const role = safeRole(req.body?.role);
    if (!role) throw appError('VALIDATION_ERROR', 'Invalid role');
    const target = await repos.findMembership(req.params.userId, req.user.orgId);
    if (!target) throw appError('RESOURCE_NOT_FOUND', 'Not a member');
    if (target.role === 'owner') throw appError('FORBIDDEN', 'Owner role cannot be changed here');
    if (role === 'owner' && !req.user.isAdmin && req.user.role !== 'owner') {
      throw appError('FORBIDDEN', 'Only the owner can promote to owner');
    }

    const updated = await repos.updateMembershipRole(req.params.userId, req.user.orgId, role);
    await audit(req, 'change_role', 'membership', req.params.userId, { role: target.role }, { role: updated.role });
    res.json({ member: updated });
  }));

  // DELETE /:userId — remove a member (never the owner).
  router.delete('/:userId', asyncHandler(async (req, res) => {
    const target = await repos.findMembership(req.params.userId, req.user.orgId);
    if (!target) throw appError('RESOURCE_NOT_FOUND', 'Not a member');
    if (target.role === 'owner') throw appError('FORBIDDEN', 'The owner cannot be removed');

    await repos.deleteMembership(req.params.userId, req.user.orgId);
    await audit(req, 'remove_membership', 'membership', req.params.userId, { role: target.role }, null);
    res.json({ ok: true });
  }));

  return router;
}
