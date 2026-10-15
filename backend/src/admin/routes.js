import express from 'express';
import { randomUUID } from 'node:crypto';
import { appError } from '../errors.js';
import { asyncHandler } from '../server/middleware.js';
import { BILLING_INTERVALS } from '../billing/license.js';
import { hashTeamPassword, newTeamPassword } from '../esp32/password.js';

// GLOBAL admin panel (platform-wide). Mounted at /api/admin behind
// requireGlobalAdmin + a rate limiter. Manages users, organizations, their
// memberships and licenses — "everything database related".
//
// This is the platform surface, distinct from the org-level members router.
// Global admins are granted out-of-band (ADMIN_EMAILS env or promote script),
// never by users themselves. Every write goes through admin_audit_log.

const LIC_STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'expired'];
const MEMBER_ROLES = ['member', 'admin', 'owner'];
const safeRole = (r) => (MEMBER_ROLES.includes(r) ? r : '');

export function createAdminRouter({ repos }) {
  const router = express.Router();
  const usersRouter = express.Router();
  const orgsRouter = express.Router();
  const licensesRouter = express.Router();
  const devicesRouter = express.Router();

  const audit = (req, action, targetType, targetId, orgId, before, after) =>
    repos.createAdminAuditLog({
      actorUserId: req.user.id,
      scope: 'global',
      action,
      targetType,
      targetId: String(targetId),
      orgId: orgId || null,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
    });

  const sanitizeMember = (m) => (m ? { userId: m.userId, role: m.role, name: m.name, email: m.email, isActive: m.isActive } : m);
  const sanitizeLicense = (l) => (l ? { id: l.id, orgId: l.orgId, plan: l.plan, seats: l.seats, status: l.status, currentPeriodEnd: l.currentPeriodEnd, createdAt: l.createdAt } : l);

  // ===================== Users =====================
  usersRouter.get('/', asyncHandler(async (req, res) => {
    const search = req.query?.search?.trim();
    const rows = await repos.listUsers(search);
    res.json({ users: rows.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, isActive: u.isActive !== false, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })) });
  }));

  // Create a user record by email/name (admin tooling — e.g. to pre-add a team
  // member). Google auth later matches by google_sub, so this user can only
  // sign in once their Google account is linked externally.
  usersRouter.post('/', asyncHandler(async (req, res) => {
    const email = (req.body?.email || '').trim().toLowerCase();
    const name = (req.body?.name || '').trim();
    if (!email) throw appError('VALIDATION_ERROR', 'Email is required');
    if (await repos.findUserByEmail(email)) throw appError('CONFLICT', 'A user with that email already exists');
    const user = await repos.createUser({ googleSub: `manual-${randomUUID()}`, email, name: name || null, lastLoginAt: null });
    await audit(req, 'create_user', 'user', user.id, null, null, { email: user.email, name: user.name });
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive !== false } });
  }));

  usersRouter.post('/:id/promote', asyncHandler(async (req, res) => {
    const u = await repos.findUserById(req.params.id);
    if (!u) throw appError('RESOURCE_NOT_FOUND', 'User not found');
    const updated = await repos.updateUser(u.id, { role: 'admin' });
    await repos.revokeAllSessionsForUser(u.id);
    await audit(req, 'promote', 'user', u.id, null, { role: u.role }, { role: 'admin' });
    res.json({ ok: true, user: { id: updated.id, role: updated.role } });
  }));

  usersRouter.post('/:id/demote', asyncHandler(async (req, res) => {
    const u = await repos.findUserById(req.params.id);
    if (!u) throw appError('RESOURCE_NOT_FOUND', 'User not found');
    if (u.id === req.user.id) throw appError('FORBIDDEN', 'You cannot demote yourself');
    const updated = await repos.updateUser(u.id, { role: 'user' });
    await audit(req, 'demote', 'user', u.id, null, { role: u.role }, { role: 'user' });
    res.json({ ok: true, user: { id: updated.id, role: updated.role } });
  }));

  usersRouter.post('/:id/deactivate', asyncHandler(async (req, res) => {
    const u = await repos.findUserById(req.params.id);
    if (!u) throw appError('RESOURCE_NOT_FOUND', 'User not found');
    if (u.id === req.user.id) throw appError('FORBIDDEN', 'You cannot deactivate yourself');
    const updated = await repos.updateUser(u.id, { isActive: false });
    await repos.revokeAllSessionsForUser(u.id);
    await audit(req, 'deactivate', 'user', u.id, null, { isActive: true }, { isActive: false });
    res.json({ ok: true, user: { id: updated.id, isActive: updated.isActive !== false } });
  }));

  usersRouter.post('/:id/activate', asyncHandler(async (req, res) => {
    const u = await repos.findUserById(req.params.id);
    if (!u) throw appError('RESOURCE_NOT_FOUND', 'User not found');
    const updated = await repos.updateUser(u.id, { isActive: true });
    await audit(req, 'activate', 'user', u.id, null, { isActive: false }, { isActive: true });
    res.json({ ok: true, user: { id: updated.id, isActive: updated.isActive !== false } });
  }));

  usersRouter.post('/:id/revoke-sessions', asyncHandler(async (req, res) => {
    const u = await repos.findUserById(req.params.id);
    if (!u) throw appError('RESOURCE_NOT_FOUND', 'User not found');
    await repos.revokeAllSessionsForUser(u.id);
    await audit(req, 'revoke_sessions', 'user', u.id, null, null, { revoked: true });
    res.json({ ok: true });
  }));

  usersRouter.delete('/:id', asyncHandler(async (req, res) => {
    const u = await repos.findUserById(req.params.id);
    if (!u) throw appError('RESOURCE_NOT_FOUND', 'User not found');
    if (u.id === req.user.id) throw appError('FORBIDDEN', 'You cannot delete yourself');
    const owned = await repos.countOwnedOrgs(u.id);
    if (owned > 0) {
      throw appError('CONFLICT', 'User owns one or more orgs — transfer ownership or delete those orgs first');
    }
    await repos.deleteUserById(u.id); // cascades memberships + auth_sessions
    await audit(req, 'delete', 'user', u.id, null, { email: u.email, name: u.name }, null);
    res.json({ ok: true });
  }));

  // ===================== Organizations =====================
  orgsRouter.get('/', asyncHandler(async (req, res) => {
    const orgs = await repos.listOrgs();
    const out = [];
    for (const o of orgs) {
      const owner = await repos.findUserById(o.ownerUserId);
      const lic = await repos.getLicenseByOrgId(o.id);
      out.push({ id: o.id, name: o.name, ownerUserId: o.ownerUserId, ownerEmail: owner?.email || null, ownerName: owner?.name || null, plan: lic?.plan || null, licenseStatus: lic?.status || null, createdAt: o.createdAt });
    }
    res.json({ orgs: out });
  }));

  orgsRouter.post('/', asyncHandler(async (req, res) => {
    const name = (req.body?.name || '').trim();
    const ownerEmail = (req.body?.ownerEmail || '').trim().toLowerCase();
    if (!name) throw appError('VALIDATION_ERROR', 'Team name is required');
    const owner = ownerEmail ? await repos.findUserByEmail(ownerEmail) : await repos.findUserById(req.user.id);
    if (!owner) throw appError('RESOURCE_NOT_FOUND', 'Owner user not found');
    const org = await repos.createOrganization({ name, ownerUserId: owner.id });
    await repos.createMembership({ userId: owner.id, orgId: org.id, role: 'owner' });
    await audit(req, 'create_org', 'org', org.id, org.id, null, { name: org.name, ownerUserId: owner.id });
    res.json({ org });
  }));

  orgsRouter.get('/:id', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    const [members, lic] = await Promise.all([
      repos.listMembersWithUser(org.id),
      repos.getLicenseByOrgId(org.id),
    ]);
    res.json({ org: { id: org.id, name: org.name, ownerUserId: org.ownerUserId, createdAt: org.createdAt }, members: members.map(sanitizeMember), license: sanitizeLicense(lic) });
  }));

  orgsRouter.put('/:id', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    const name = (req.body?.name || '').trim();
    if (!name) throw appError('VALIDATION_ERROR', 'Team name is required');
    const updated = await repos.updateOrganization(org.id, { name });
    await audit(req, 'rename_org', 'org', org.id, org.id, { name: org.name }, { name: updated.name });
    res.json({ org: { id: updated.id, name: updated.name } });
  }));

  orgsRouter.post('/:id/transfer-owner', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    const newOwnerId = req.body?.userId;
    const newOwner = await repos.findMembership(newOwnerId, org.id);
    if (!newOwner) throw appError('RESOURCE_NOT_FOUND', 'New owner must be an existing member');
    const oldOwnerId = org.ownerUserId;

    await repos.updateOrganization(org.id, { ownerUserId: newOwnerId });
    if (newOwner.role !== 'owner') await repos.updateMembershipRole(newOwnerId, org.id, 'owner');
    // Demote the previous owner to admin (keeps them in the team, no longer owner).
    if (oldOwnerId !== newOwnerId) {
      const oldMembership = await repos.findMembership(oldOwnerId, org.id);
      if (oldMembership) await repos.updateMembershipRole(oldOwnerId, org.id, 'admin');
    }
    await audit(req, 'transfer_owner', 'org', org.id, org.id, { ownerUserId: oldOwnerId }, { ownerUserId: newOwnerId });
    res.json({ ok: true });
  }));

  orgsRouter.delete('/:id', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    await repos.deleteOrganizationById(org.id); // sequences constrain-child deletion
    await audit(req, 'delete_org', 'org', org.id, org.id, { name: org.name }, null);
    res.json({ ok: true });
  }));

  // ---- License for a specific org ----
  orgsRouter.post('/:id/license', asyncHandler(async (req, res) => {
    const lic = await repos.getLicenseByOrgId(req.params.id);
    if (lic) throw appError('CONFLICT', 'Org already has a license');
    const plan = req.body?.plan;
    const seats = Number(req.body?.seats);
    const status = req.body?.status || 'active';
    if (!BILLING_INTERVALS.includes(plan)) throw appError('VALIDATION_ERROR', 'Unknown plan (monthly | annual)');
    if (!LIC_STATUSES.includes(status)) throw appError('VALIDATION_ERROR', 'Invalid license status');
    const created = await repos.createLicense({
      orgId: req.params.id,
      plan,
      seats: Number.isInteger(seats) && seats > 0 ? seats : 5,
      status,
    });
    await audit(req, 'create_license', 'license', created.id, req.params.id, null, sanitizeLicense(created));
    res.json({ license: sanitizeLicense(created) });
  }));

  orgsRouter.put('/:id/license', asyncHandler(async (req, res) => {
    const lic = await repos.getLicenseByOrgId(req.params.id);
    if (!lic) throw appError('RESOURCE_NOT_FOUND', 'No license for this org');
    const patch = {};
    if (req.body?.plan !== undefined) {
      if (!BILLING_INTERVALS.includes(req.body.plan)) throw appError('VALIDATION_ERROR', 'Unknown plan (monthly | annual)');
      patch.plan = req.body.plan;
    }
    if (req.body?.seats !== undefined) {
      const seats = Number(req.body.seats);
      if (!Number.isInteger(seats) || seats <= 0) throw appError('VALIDATION_ERROR', 'Seats must be a positive integer');
      patch.seats = seats;
    }
    if (req.body?.status !== undefined) {
      if (!LIC_STATUSES.includes(req.body.status)) throw appError('VALIDATION_ERROR', 'Invalid license status');
      patch.status = req.body.status;
    }
    const updated = await repos.updateLicenseById(lic.id, patch);
    await audit(req, 'update_license', 'license', lic.id, req.params.id, sanitizeLicense(lic), sanitizeLicense(updated));
    res.json({ license: sanitizeLicense(updated) });
  }));

  orgsRouter.delete('/:id/license', asyncHandler(async (req, res) => {
    const lic = await repos.getLicenseByOrgId(req.params.id);
    if (!lic) throw appError('RESOURCE_NOT_FOUND', 'No license for this org');
    await repos.deleteLicenseByOrgId(req.params.id);
    await audit(req, 'delete_license', 'license', lic.id, req.params.id, sanitizeLicense(lic), null);
    res.json({ ok: true });
  }));

  // ---- Members (any org, global admin) ----
  orgsRouter.get('/:id/members', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    const members = await repos.listMembersWithUser(org.id);
    res.json({ members: members.map(sanitizeMember) });
  }));

  orgsRouter.post('/:id/members', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    const email = (req.body?.email || '').trim().toLowerCase();
    const role = safeRole(req.body?.role) || 'member';
    if (!email) throw appError('VALIDATION_ERROR', 'Email is required');
    if (!role) throw appError('VALIDATION_ERROR', 'Invalid role');
    const user = await repos.findUserByEmail(email);
    if (!user) throw appError('RESOURCE_NOT_FOUND', 'No user with that email');
    if (await repos.findMembership(user.id, org.id)) throw appError('CONFLICT', 'User is already a member');
    const member = await repos.createMembership({ userId: user.id, orgId: org.id, role });
    await audit(req, 'create_membership', 'membership', user.id, org.id, null, { role });
    res.json({ member });
  }));

  orgsRouter.put('/:id/members/:userId', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    const role = safeRole(req.body?.role);
    if (!role) throw appError('VALIDATION_ERROR', 'Invalid role');
    const target = await repos.findMembership(req.params.userId, org.id);
    if (!target) throw appError('RESOURCE_NOT_FOUND', 'Not a member');
    const isOwner = org.ownerUserId === req.params.userId;

    if (role === 'owner') {
      if (!isOwner) {
        // Promote: move the single-owner pointer to user, demote the previous owner.
        const oldOwnerId = org.ownerUserId;
        await repos.updateOrganization(org.id, { ownerUserId: req.params.userId });
        if (oldOwnerId && oldOwnerId !== req.params.userId) {
          const oldMembership = await repos.findMembership(oldOwnerId, org.id);
          if (oldMembership) await repos.updateMembershipRole(oldOwnerId, org.id, 'admin');
        }
      }
      const updated = await repos.updateMembershipRole(req.params.userId, org.id, 'owner');
      await audit(req, 'change_role', 'membership', req.params.userId, org.id, { role: target.role }, { role: 'owner' });
      return res.json({ member: updated });
    }

    // Demoting the current owner would leave the org owned by nobody — require transfer.
    if (isOwner) throw appError('FORBIDDEN', 'Cannot demote the owner — transfer ownership first');
    const updated = await repos.updateMembershipRole(req.params.userId, org.id, role);
    await audit(req, 'change_role', 'membership', req.params.userId, org.id, { role: target.role }, { role: updated.role });
    res.json({ member: updated });
  }));

  orgsRouter.delete('/:id/members/:userId', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    const target = await repos.findMembership(req.params.userId, org.id);
    if (!target) throw appError('RESOURCE_NOT_FOUND', 'Not a member');
    if (org.ownerUserId === req.params.userId) throw appError('FORBIDDEN', 'Cannot remove the owner — transfer ownership first');
    await repos.deleteMembership(req.params.userId, org.id);
    await audit(req, 'remove_membership', 'membership', req.params.userId, org.id, { role: target.role }, null);
    res.json({ ok: true });
  }));

  // ---- InLap Box (ESP32) devices of a specific org (global admin surface) ----
  const sanitizeDevice = (d) => (d ? { id: d.id, uuid: d.uuid, orgId: d.orgId, orgName: d.orgName || null, deviceName: d.deviceName, pilotName: d.pilotName, approved: d.approved, registeredAt: d.registeredAt, lastConnectionAt: d.lastConnectionAt } : d);

  orgsRouter.get('/:id/devices', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    const devices = await repos.listEsp32Devices(org.id);
    res.json({ devices: devices.map((d) => sanitizeDevice({ ...d, orgName: org.name })) });
  }));

  // Regenerate the org's device (provisioning) password; shown once, only the
  // hash is stored. Existing boxes keep their JWTs; only NEW registrations use it.
  orgsRouter.post('/:id/device-password', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.params.id);
    if (!org) throw appError('RESOURCE_NOT_FOUND', 'Organization not found');
    const password = newTeamPassword();
    await repos.updateOrganization(org.id, {
      devicePasswordHash: hashTeamPassword(password),
      devicePasswordCreatedAt: new Date(),
    });
    const updated = await repos.getOrganizationById(org.id);
    await audit(req, 'regenerate_device_password', 'organization', org.id, org.id, null, { createdAt: updated.devicePasswordCreatedAt });
    res.json({ orgId: org.id, password, generatedAt: updated.devicePasswordCreatedAt });
  }));

  // ===================== Licenses =====================
  licensesRouter.get('/', asyncHandler(async (req, res) => {
    const lic = await repos.listLicenses();
    res.json({ licenses: lic.map(sanitizeLicense) });
  }));

  // ===================== ESP32 devices (all teams) =====================
  // Platform-wide device management. GET supports ?orgId= and ?q= filters.
  devicesRouter.get('/', asyncHandler(async (req, res) => {
    let rows = await repos.listAllEsp32Devices();
    if (req.query?.orgId) rows = rows.filter((d) => d.orgId === req.query.orgId);
    const q = (req.query?.q || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((d) =>
        (d.deviceName || '').toLowerCase().includes(q) ||
        d.uuid.toLowerCase().includes(q) ||
        (d.orgName || '').toLowerCase().includes(q));
    }
    res.json({ devices: rows.map(sanitizeDevice) });
  }));

  // DELETE /api/admin/devices/:id — revoke a box from ANY team. Its JWTs stop
  // being accepted on the WS upgrade (device gone => approval check fails).
  devicesRouter.delete('/:id', asyncHandler(async (req, res) => {
    const device = await repos.getEsp32Device(req.params.id);
    if (!device) throw appError('RESOURCE_NOT_FOUND', 'Device not found');
    await repos.deleteEsp32Device(device.orgId, req.params.id);
    await audit(req, 'delete_esp32_device', 'esp32_device', req.params.id, device.orgId, sanitizeDevice(device), null);
    res.json({ ok: true });
  }));

  router.use('/users', usersRouter);
  router.use('/orgs', orgsRouter);
  router.use('/licenses', licensesRouter);
  router.use('/devices', devicesRouter);

  // GET /api/admin/logs — recent privileged actions (audit trail).
  router.get('/logs', asyncHandler(async (req, res) => {
    const orgId = req.query?.orgId || null;
    const rows = await repos.listAdminAuditLog(orgId ? { orgId } : {});
    res.json({ logs: rows });
  }));

  return router;
}
