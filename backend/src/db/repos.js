// Repository layer. Every multi-tenant query is scoped by orgId obtained from
// the AUTHENTICATED session — never from client input (spec section 35).
//
// Prohibited pattern:
//   raceConfigs.findById(req.params.id)            // ❌ no org scope
// Required pattern:
//   getRaceConfig(orgId, req.params.id)             // ✅ org_id from session
import { randomUUID } from 'node:crypto';
import { eq, and, or, like, sql, desc, asc, lte, isNull, isNotNull } from 'drizzle-orm';
import {
  users,
  organizations,
  esp32Devices,
  memberships,
  licenses,
  raceConfigs,
  raceSessions,
  authSessions,
  stripeWebhookEvents,
  raceLaps,
  raceEvents,
  raceSnapshots,
  adminAuditLog,
  esp32CommandConfigs,
  esp32DeviceLogs,
} from './schema.js';

export function makeRepos(db) {
  if (!db) throw new Error('makeRepos requires a db instance');

  // IDs are generated app-side (standard practice) and survive pg-mem tests,
  // where Postgres DEFAULT gen_random_uuid() is evaluated only once per column.
  const ensureId = (data) => ({ ...data, id: data.id ?? randomUUID() });

  // ---- users ----
  const findUserByGoogleSub = (googleSub) =>
    db.select().from(users).where(eq(users.googleSub, googleSub)).limit(1).then((r) => r[0] || null);

  const findUserById = (id) =>
    db.select().from(users).where(eq(users.id, id)).limit(1).then((r) => r[0] || null);

  const findUserByEmail = (email) =>
    db.select().from(users).where(eq(users.email, email)).limit(1).then((r) => r[0] || null);

  const createUser = (data) =>
    db.insert(users).values(ensureId(data)).returning().then((r) => r[0]);

  const updateUser = (id, data) =>
    db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id)).returning().then((r) => r[0] || null);

  const deleteUserById = (id) =>
    db.delete(users).where(eq(users.id, id)).returning().then((r) => r[0] || null);

  // ---- admin: users list (search by email/name) & deactivate ----
  const listUsers = (search) => {
    const q = db.select().from(users);
    if (search) {
      const pat = `%${search}%`;
      return q.where(or(like(users.email, pat), like(users.name, pat))).orderBy(desc(users.createdAt));
    }
    return q.orderBy(desc(users.createdAt));
  };

  const revokeAllSessionsForUser = (userId) =>
    db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));

  // ---- organizations ----
  const createOrganization = (data) =>
    db.insert(organizations).values(ensureId(data)).returning().then((r) => r[0]);

  const getOrganizationById = (orgId) =>
    db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1).then((r) => r[0] || null);

  const updateOrganization = (id, data) =>
    db.update(organizations).set({ ...data, updatedAt: new Date() }).where(eq(organizations.id, id)).returning().then((r) => r[0] || null);

  // ---- esp32_devices (always scoped by orgId) ----
  const listEsp32Devices = (orgId) =>
    db
      .select()
      .from(esp32Devices)
      .where(eq(esp32Devices.orgId, orgId))
      .orderBy(desc(esp32Devices.registeredAt));

  // Global admin surface: every device, joined with its team name.
  const listAllEsp32Devices = () =>
    db
      .select({
        id: esp32Devices.id,
        uuid: esp32Devices.uuid,
        orgId: esp32Devices.orgId,
        orgName: organizations.name,
        deviceName: esp32Devices.deviceName,
        approved: esp32Devices.approved,
        registeredAt: esp32Devices.registeredAt,
        lastConnectionAt: esp32Devices.lastConnectionAt,
      })
      .from(esp32Devices)
      .innerJoin(organizations, eq(esp32Devices.orgId, organizations.id))
      .orderBy(desc(esp32Devices.registeredAt));

  // Global (unscoped) lookups used ONLY by the global admin router, which runs
  // behind requireGlobalAdmin — never by the org-scoped team router.
  const getEsp32Device = (id) =>
    db.select().from(esp32Devices).where(eq(esp32Devices.id, id)).limit(1).then((r) => r[0] || null);

  const getEsp32DeviceById = (orgId, id) =>
    db
      .select()
      .from(esp32Devices)
      .where(and(eq(esp32Devices.orgId, orgId), eq(esp32Devices.id, id)))
      .limit(1)
      .then((r) => r[0] || null);

  const getEsp32DeviceByOrgAndUuid = (orgId, uuid) =>
    db
      .select()
      .from(esp32Devices)
      .where(and(eq(esp32Devices.orgId, orgId), eq(esp32Devices.uuid, uuid)))
      .limit(1)
      .then((r) => r[0] || null);

  // Global lookup (uuid is unique platform-wide): used to detect a box that is
  // already registered to ANOTHER team.
  const getEsp32DeviceByUuid = (uuid) =>
    db
      .select()
      .from(esp32Devices)
      .where(eq(esp32Devices.uuid, uuid))
      .limit(1)
      .then((r) => r[0] || null);

  // Register (or re-register) a box. The chip uuid is unique per org: a re-register
  // updates the pilot-set name and pings last_connection instead of duplicating.
  const upsertEsp32Device = async ({ orgId, uuid, deviceName, pilotName }) => {
    const existing = await getEsp32DeviceByOrgAndUuid(orgId, uuid);
    if (existing) {
      const updated = await db
        .update(esp32Devices)
        .set({
          deviceName: deviceName ?? existing.deviceName,
          pilotName: pilotName ?? existing.pilotName,
          lastConnectionAt: new Date(),
        })
        .where(eq(esp32Devices.id, existing.id))
        .returning();
      return { created: false, device: updated[0] };
    }
    const created = await db
      .insert(esp32Devices)
      .values(ensureId({ orgId, uuid, deviceName: deviceName ?? '', pilotName: pilotName ?? '' }))
      .returning();
    return { created: true, device: created[0] };
  };

  const deleteEsp32Device = (orgId, id) =>
    db
      .delete(esp32Devices)
      .where(and(eq(esp32Devices.orgId, orgId), eq(esp32Devices.id, id)))
      .returning()
      .then((r) => r[0] || null);

  const updateEsp32Device = (orgId, id, data) =>
    db
      .update(esp32Devices)
      .set(data)
      .where(and(eq(esp32Devices.orgId, orgId), eq(esp32Devices.id, id)))
      .returning()
      .then((r) => r[0] || null);

  const getEsp32DeviceByPilotName = (orgId, pilotName) =>
    db.select().from(esp32Devices)
      .where(and(eq(esp32Devices.orgId, orgId), eq(esp32Devices.pilotName, pilotName)))
      .limit(1).then((r) => r[0] || null);

  const touchEsp32Device = (orgId, uuid) =>
    db
      .update(esp32Devices)
      .set({ lastConnectionAt: new Date() })
      .where(and(eq(esp32Devices.orgId, orgId), eq(esp32Devices.uuid, uuid)));

  // ---- admin: all orgs ----
  const listOrgs = () =>
    db.select().from(organizations).orderBy(desc(organizations.createdAt));

  // Delete an org by clearing its restrict-FK children (sessions -> configs ->
  // license) then the org row. Memberships cascade on org delete.
  const deleteOrganizationById = async (orgId) => {
    await deleteRaceSessionsByOrg(orgId);
    await deleteRaceConfigsByOrg(orgId);
    await deleteLicenseByOrgId(orgId);
    const [row] = await db.delete(organizations).where(eq(organizations.id, orgId)).returning();
    return row || null;
  };

  const deleteRaceSessionsByOrg = (orgId) =>
    db.delete(raceSessions).where(eq(raceSessions.orgId, orgId));

  const deleteRaceConfigsByOrg = (orgId) =>
    db.delete(raceConfigs).where(eq(raceConfigs.orgId, orgId));

  const deleteLicenseByOrgId = (orgId) =>
    db.delete(licenses).where(eq(licenses.orgId, orgId)).returning().then((r) => r[0] || null);

  // ---- memberships ----
  const createMembership = (data) =>
    db.insert(memberships).values(data).returning().then((r) => r[0]);

  const findMembership = (userId, orgId) =>
    db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
      .limit(1)
      .then((r) => r[0] || null);

  // First org the user belongs to (owner membership first). Used to resolve
  // req.user.orgId before multi-org switching exists.
  const getUserPrimaryOrg = (userId) =>
    db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .orderBy(desc(memberships.createdAt))
      .limit(1)
      .then((r) => r[0] || null);

  const listMembershipsByUser = (userId) =>
    db.select().from(memberships).where(eq(memberships.userId, userId));

  const listMembershipsByOrg = (orgId) =>
    db.select().from(memberships).where(eq(memberships.orgId, orgId));

  // Lead memberships with the user's name/email for the team member list.
  const listMembersWithUser = (orgId) =>
    db
      .select({
        userId: memberships.userId,
        orgId: memberships.orgId,
        role: memberships.role,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(desc(memberships.role));

  const updateMembershipRole = (userId, orgId, role) =>
    db
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
      .returning()
      .then((r) => r[0] || null);

  const deleteMembership = (userId, orgId) =>
    db
      .delete(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
      .returning()
      .then((r) => r[0] || null);

  // ---- licenses ----
  const getLicenseByOrgId = (orgId) =>
    db.select().from(licenses).where(eq(licenses.orgId, orgId)).limit(1).then((r) => r[0] || null);

  const createLicense = (data) =>
    db.insert(licenses).values(ensureId(data)).returning().then((r) => r[0]);

  const updateLicenseById = (id, data) =>
    db
      .update(licenses)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(licenses.id, id))
      .returning()
      .then((r) => r[0] || null);

  const findLicenseByStripeCustomerId = (customerId) =>
    db.select().from(licenses).where(eq(licenses.stripeCustomerId, customerId)).limit(1).then((r) => r[0] || null);

  const findLicenseByStripeSubscriptionId = (subscriptionId) =>
    db.select().from(licenses).where(eq(licenses.stripeSubscriptionId, subscriptionId)).limit(1).then((r) => r[0] || null);

  // ---- admin: all licenses ----
  const listLicenses = () =>
    db.select().from(licenses).orderBy(desc(licenses.createdAt));

  // ---- race_configs (always scoped by orgId) ----
  const listRaceConfigs = (orgId) =>
    db.select().from(raceConfigs).where(eq(raceConfigs.orgId, orgId)).orderBy(desc(raceConfigs.updatedAt));

  const getRaceConfig = (orgId, id) =>
    db
      .select()
      .from(raceConfigs)
      .where(and(eq(raceConfigs.orgId, orgId), eq(raceConfigs.id, id)))
      .limit(1)
      .then((r) => r[0] || null);

  const createRaceConfig = (data) =>
    db.insert(raceConfigs).values(ensureId(data)).returning().then((r) => r[0]);

  const updateRaceConfig = (orgId, id, data) =>
    db
      .update(raceConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(raceConfigs.orgId, orgId), eq(raceConfigs.id, id)))
      .returning()
      .then((r) => r[0] || null);

  const deleteRaceConfig = (orgId, id) =>
    db
      .delete(raceConfigs)
      .where(and(eq(raceConfigs.orgId, orgId), eq(raceConfigs.id, id)))
      .returning()
      .then((r) => r[0] || null);

  // ---- race_sessions (always scoped by orgId) ----
  const listRaceSessions = (orgId) =>
    db.select().from(raceSessions).where(eq(raceSessions.orgId, orgId)).orderBy(desc(raceSessions.createdAt));

  const listRunningSessions = () =>
    db.select().from(raceSessions).where(eq(raceSessions.status, 'running'));

  const getRaceSession = (orgId, id) =>
    db
      .select()
      .from(raceSessions)
      .where(and(eq(raceSessions.orgId, orgId), eq(raceSessions.id, id)))
      .limit(1)
      .then((r) => r[0] || null);

  const createRaceSession = (data) =>
    db.insert(raceSessions).values(ensureId(data)).returning().then((r) => r[0]);

  const updateRaceSession = (orgId, id, data) =>
    db
      .update(raceSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(raceSessions.orgId, orgId), eq(raceSessions.id, id)))
      .returning()
      .then((r) => r[0] || null);

  // Hard delete (cascade removes race_laps + race_events). Used by DELETE
  // /api/race-sessions/:id.
  const deleteRaceSessionById = (id) =>
    db.delete(raceSessions).where(eq(raceSessions.id, id)).returning().then((r) => r[0] || null);

  const setRaceSessionStatus = (orgId, id, status) =>
    updateRaceSession(orgId, id, { status });

  // ---- auth_sessions ----
  const createAuthSession = (data) =>
    db.insert(authSessions).values(ensureId(data)).returning().then((r) => r[0]);

  const findAuthSessionByTokenHash = (tokenHash) =>
    db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)))
      .limit(1)
      .then((r) => r[0] || null);

  const revokeAuthSession = (tokenHash) =>
    db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.tokenHash, tokenHash))
      .returning()
      .then((r) => r[0] || null);

  const deleteExpiredAuthSessions = () =>
    db
      .delete(authSessions)
      .where(lte(authSessions.expiresAt, new Date()))
      .returning()
      .then((r) => r.length);

  // ---- admin_audit_log ----
  const createAdminAuditLog = (data) =>
    db.insert(adminAuditLog).values(ensureId(data)).returning().then((r) => r[0]);

  const listAdminAuditLog = (opts = {}) => {
    const q = db.select().from(adminAuditLog);
    if (opts.orgId) {
      return q.where(eq(adminAuditLog.orgId, opts.orgId)).orderBy(desc(adminAuditLog.createdAt)).limit(opts.limit || 100);
    }
    return q.orderBy(desc(adminAuditLog.createdAt)).limit(opts.limit || 200);
  };

  // Does the user own ANY org that references them (organizations.ownerUserId
  // is FK restrict)? If so, deleting the user is blocked until ownership is
  // transferred. Used by the admin delete-user flow.
  const countOwnedOrgs = (userId) =>
    db
      .select({ count: sql`count(*)::int` })
      .from(organizations)
      .where(eq(organizations.ownerUserId, userId))
      .then((r) => r[0]?.count || 0);

  // ---- stripe_webhook_events (idempotency ledger) ----
  // Returns true when this event id was newly recorded, false if a duplicate.
  const recordStripeWebhookEvent = (stripeEventId) =>
    db
      .insert(stripeWebhookEvents)
      .values({ id: randomUUID(), stripeEventId })
      .onConflictDoNothing()
      .returning()
      .then((r) => r.length === 1);

  // ---- telemetry (Pro only; race_laps + race_events) ----
  const insertRaceLaps = (rows) =>
    db
      .insert(raceLaps)
      .values(rows.map((r) => ({ ...r, id: r.id ?? randomUUID() })))
      .returning()
      .then((r) => r.length);

  const insertRaceEvents = (rows) =>
    db
      .insert(raceEvents)
      .values(rows.map((r) => ({ ...r, id: r.id ?? randomUUID() })))
      .returning()
      .then((r) => r.length);

  const getRaceLapsForSession = (raceSessionId) =>
    db
      .select()
      .from(raceLaps)
      .where(eq(raceLaps.raceSessionId, raceSessionId))
      .orderBy(asc(raceLaps.kart), asc(raceLaps.lapNumber));

  const getRaceEventsForSession = (raceSessionId) =>
    db
      .select()
      .from(raceEvents)
      .where(eq(raceEvents.raceSessionId, raceSessionId))
      .orderBy(asc(raceEvents.timestamp));

  const insertRaceSnapshots = (rows) =>
    db
      .insert(raceSnapshots)
      .values(rows.map((r) => ({ ...r, id: r.id ?? randomUUID() })))
      .returning()
      .then((r) => r.length);

  const getRaceSnapshotsForSession = (raceSessionId) =>
    db
      .select()
      .from(raceSnapshots)
      .where(eq(raceSnapshots.raceSessionId, raceSessionId))
      .orderBy(asc(raceSnapshots.timestamp));

  // ---- esp32_command_configs (per-device command settings) ----
  const listCommandConfigs = (deviceId) =>
    db.select().from(esp32CommandConfigs)
      .where(eq(esp32CommandConfigs.deviceId, deviceId))
      .orderBy(asc(esp32CommandConfigs.commandType));

  const getCommandConfig = (deviceId, commandType) =>
    db.select().from(esp32CommandConfigs)
      .where(and(eq(esp32CommandConfigs.deviceId, deviceId), eq(esp32CommandConfigs.commandType, commandType)))
      .limit(1).then((r) => r[0] || null);

  const upsertCommandConfig = async ({ deviceId, commandType, commandText, intervalMs, enabled }) => {
    const existing = await getCommandConfig(deviceId, commandType);
    if (existing) {
      const [row] = await db.update(esp32CommandConfigs)
        .set({ commandText, intervalMs, enabled, updatedAt: new Date() })
        .where(eq(esp32CommandConfigs.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db.insert(esp32CommandConfigs)
      .values(ensureId({ deviceId, commandType, commandText: commandText ?? '', intervalMs, enabled: enabled ?? true }))
      .returning();
    return row;
  };

  const deleteCommandConfig = (deviceId, commandType) =>
    db.delete(esp32CommandConfigs)
      .where(and(eq(esp32CommandConfigs.deviceId, deviceId), eq(esp32CommandConfigs.commandType, commandType)))
      .returning().then((r) => r[0] || null);

  const getScheduledConfigsForDevice = (deviceId) =>
    db.select({
      id: esp32CommandConfigs.id,
      commandType: esp32CommandConfigs.commandType,
      commandText: esp32CommandConfigs.commandText,
      intervalMs: esp32CommandConfigs.intervalMs,
    }).from(esp32CommandConfigs)
      .where(and(
        eq(esp32CommandConfigs.deviceId, deviceId),
        eq(esp32CommandConfigs.enabled, true),
        isNotNull(esp32CommandConfigs.intervalMs),
      ));

  // ---- esp32_device_logs (event log per device) ----
  const logEsp32Device = ({ deviceId, orgId, event, detail }) =>
    db.insert(esp32DeviceLogs)
      .values({ id: randomUUID(), deviceId, orgId, event, detail: detail || null })
      .returning().then((r) => r[0]);

  const listDeviceLogs = (deviceId, { limit = 50, offset = 0 } = {}) =>
    db.select().from(esp32DeviceLogs)
      .where(eq(esp32DeviceLogs.deviceId, deviceId))
      .orderBy(desc(esp32DeviceLogs.createdAt))
      .limit(limit)
      .offset(offset);

  const listOrgDeviceLogs = (orgId, { limit = 100, offset = 0 } = {}) =>
    db.select({
      id: esp32DeviceLogs.id,
      deviceId: esp32DeviceLogs.deviceId,
      event: esp32DeviceLogs.event,
      detail: esp32DeviceLogs.detail,
      createdAt: esp32DeviceLogs.createdAt,
      deviceName: esp32Devices.deviceName,
      pilotName: esp32Devices.pilotName,
      uuid: esp32Devices.uuid,
    }).from(esp32DeviceLogs)
      .innerJoin(esp32Devices, eq(esp32DeviceLogs.deviceId, esp32Devices.id))
      .where(eq(esp32DeviceLogs.orgId, orgId))
      .orderBy(desc(esp32DeviceLogs.createdAt))
      .limit(limit)
      .offset(offset);

return {
      listEsp32Devices,
      listAllEsp32Devices,
      getEsp32Device,
      getEsp32DeviceById,
      getEsp32DeviceByOrgAndUuid,
      getEsp32DeviceByUuid,
      upsertEsp32Device,
      deleteEsp32Device,
      touchEsp32Device,
      updateEsp32Device,
      getEsp32DeviceByPilotName,
      listCommandConfigs,
      getCommandConfig,
      upsertCommandConfig,
      deleteCommandConfig,
      getScheduledConfigsForDevice,
      logEsp32Device,
      listDeviceLogs,
      listOrgDeviceLogs,
      findUserByGoogleSub,
    findUserById,
    findUserByEmail,
    createUser,
    updateUser,
    deleteUserById,
    listUsers,
    revokeAllSessionsForUser,
    countOwnedOrgs,
    createOrganization,
    getOrganizationById,
    updateOrganization,
    listOrgs,
    deleteOrganizationById,
    createMembership,
    findMembership,
    getUserPrimaryOrg,
    listMembershipsByUser,
    listMembershipsByOrg,
    listMembersWithUser,
    updateMembershipRole,
    deleteMembership,
    getLicenseByOrgId,
    createLicense,
    updateLicenseById,
    deleteLicenseByOrgId,
    listLicenses,
    findLicenseByStripeCustomerId,
    findLicenseByStripeSubscriptionId,
    listRaceConfigs,
    getRaceConfig,
    createRaceConfig,
    updateRaceConfig,
    deleteRaceConfig,
    listRaceSessions,
    listRunningSessions,
    getRaceSession,
    createRaceSession,
    updateRaceSession,
    deleteRaceSessionById,
    setRaceSessionStatus,
    createAuthSession,
    findAuthSessionByTokenHash,
    revokeAuthSession,
    deleteExpiredAuthSessions,
    createAdminAuditLog,
    listAdminAuditLog,
    recordStripeWebhookEvent,
    insertRaceLaps,
    insertRaceEvents,
    getRaceLapsForSession,
    getRaceEventsForSession,
    insertRaceSnapshots,
    getRaceSnapshotsForSession,
  };
}
