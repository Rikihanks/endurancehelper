// InLap Box (ESP32) endpoints.
//
// Two routers:
//   1. createEsp32Router         -> POST /api/esp32/register (PUBLIC — called by
//      the box itself on first boot; it cannot do a normal login).
//   2. createEsp32AdminRouter    -> /api/team/esp32-devices (requires a logged-in
//      session; every query is scoped to req.user.orgId, never client input).
import express from 'express';
import { appError } from '../errors.js';
import { asyncHandler } from '../server/middleware.js';
import { hashTeamPassword, newTeamPassword, verifyTeamPassword } from './password.js';
import { signEsp32Token } from './token.js';

const pick = (d) => (d ? {
  id: d.id,
  uuid: d.uuid,
  deviceName: d.deviceName,
  pilotName: d.pilotName,
  approved: d.approved,
  registeredAt: d.registeredAt,
  lastConnectionAt: d.lastConnectionAt,
} : d);

// ---- Public registration (spec InLapBox §2). ----
export function createEsp32Router({ repos, rateLimitMw }) {
  const router = express.Router();
  const guard = rateLimitMw || ((req, res, next) => next());

  // POST /api/esp32/register
  // Body: { uuid, team_password, device_name }
  // 200  -> { token }  (24h JWT scoped to the team that owns the password)
  // 400  -> missing/invalid fields
  // 401  -> the password does not match any team
  router.post('/register', guard, asyncHandler(async (req, res) => {
    const { uuid, team_password, device_name, pilot_name } = req.body || {};
    if (!uuid || typeof uuid !== 'string' || !uuid.trim()) {
      throw appError('VALIDATION_ERROR', 'uuid is required');
    }
    if (!team_password || typeof team_password !== 'string') {
      throw appError('VALIDATION_ERROR', 'team_password is required');
    }
    if (device_name !== undefined && typeof device_name !== 'string') {
      throw appError('VALIDATION_ERROR', 'device_name must be a string');
    }
    if (pilot_name !== undefined && typeof pilot_name !== 'string') {
      throw appError('VALIDATION_ERROR', 'pilot_name must be a string');
    }

    // There is no team slug/code in the model yet, so the password is compared
    // against every team that has generated one (only orgs with a configured
    // password can accept box registrations).
    const orgs = await repos.listOrgs();
    let team = null;
    for (const org of orgs) {
      if (!org.devicePasswordHash) continue;
      if (verifyTeamPassword(team_password, org.devicePasswordHash)) {
        team = org;
        break;
      }
    }
    if (!team) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid team password' });
    }

    const cleanUuid = String(uuid).trim();
    // uuid is unique platform-wide: a box already registered to ANOTHER team
    // cannot be silently stolen (it would need to be revoked there first).
    const elsewhere = await repos.getEsp32DeviceByUuid(cleanUuid);
    if (elsewhere && elsewhere.orgId !== team.id) {
      throw appError('CONFLICT', 'This device is already registered to another team');
    }

    const { created, device } = await repos.upsertEsp32Device({
      orgId: team.id,
      uuid: cleanUuid,
      deviceName: device_name || '',
      pilotName: pilot_name || '',
    });

    const token = signEsp32Token({ orgId: team.id, esp32Uuid: cleanUuid });
    console.log(`[esp32] ${created ? 'registered new' : 're-registered'} device ${device.uuid} for org ${team.id}`);
    res.json({ token });
  }));

  return router;
}

// ---- Team admin (spec InLapBox §2 "Endpoints de administración"). ----
// Mounted at /api/team/esp32-devices behind requireAuth + authorizeOrg admin/owner.
export function createEsp32AdminRouter({ repos }) {
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

  // GET /api/team/esp32-devices — devices of the logged-in team.
  router.get('/', asyncHandler(async (req, res) => {
    const devices = await repos.listEsp32Devices(req.user.orgId);
    res.json({ devices: devices.map(pick) });
  }));

  // POST /api/team/esp32-devices — register a device from the web (admin sets up
  // the ESP32 before handing it to the pilot). Body: { uuid, deviceName, pilotName }
  // Returns the device AND a JWT token to embed in the ESP32 firmware.
  router.post('/', asyncHandler(async (req, res) => {
    const { uuid, deviceName, pilotName } = req.body || {};
    if (!uuid || typeof uuid !== 'string' || !uuid.trim()) {
      throw appError('VALIDATION_ERROR', 'uuid is required');
    }

    // Check if uuid is already registered to another team
    const elsewhere = await repos.getEsp32DeviceByUuid(uuid.trim());
    if (elsewhere && elsewhere.orgId !== req.user.orgId) {
      throw appError('CONFLICT', 'This device is already registered to another team');
    }

    const { created, device } = await repos.upsertEsp32Device({
      orgId: req.user.orgId,
      uuid: uuid.trim(),
      deviceName: deviceName || '',
      pilotName: pilotName || '',
    });

    const token = signEsp32Token({ orgId: req.user.orgId, esp32Uuid: uuid.trim() });
    await audit(req, created ? 'create_esp32_device' : 'update_esp32_device', 'esp32_device', String(device.id), null, pick(device));
    res.json({ device: pick(device), token });
  }));

  // POST /api/team/esp32-devices/:id/token — generate a fresh JWT for an existing device.
  // The admin can regenerate the token if needed (e.g. lost firmware, new chip).
  router.post('/:id/token', asyncHandler(async (req, res) => {
    const device = await repos.getEsp32DeviceById(req.user.orgId, req.params.id);
    if (!device) throw appError('RESOURCE_NOT_FOUND', 'Device not found');

    const token = signEsp32Token({ orgId: req.user.orgId, esp32Uuid: device.uuid });
    res.json({ token, deviceUuid: device.uuid });
  }));

  // DELETE /api/team/esp32-devices/:id — revoke a box. Its old JWTs stop being
  // accepted on the WS upgrade (device gone => approval check fails).
  router.delete('/:id', asyncHandler(async (req, res) => {
    const device = await repos.getEsp32DeviceById(req.user.orgId, req.params.id);
    if (!device) throw appError('RESOURCE_NOT_FOUND', 'Device not found');

    await repos.deleteEsp32Device(req.user.orgId, req.params.id);
    await audit(req, 'delete_esp32_device', 'esp32_device', String(req.params.id), pick(device), null);
    res.json({ ok: true });
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const device = await repos.getEsp32DeviceById(req.user.orgId, req.params.id);
    if (!device) throw appError('RESOURCE_NOT_FOUND', 'Device not found');

    const { pilotName, deviceName } = req.body || {};
    const patch = {};
    if (pilotName !== undefined) patch.pilotName = String(pilotName);
    if (deviceName !== undefined) patch.deviceName = String(deviceName);

    if (Object.keys(patch).length === 0) {
      throw appError('VALIDATION_ERROR', 'Nothing to update');
    }

    const updated = await repos.updateEsp32Device(req.user.orgId, req.params.id, patch);
    await audit(req, 'update_esp32_device', 'esp32_device', String(req.params.id), pick(device), pick(updated));
    res.json({ device: pick(updated) });
  }));

  // POST /api/team/esp32-devices/regenerate-password — new random password;
  // returned once in plain text, only the hash is stored afterwards.
  router.post('/regenerate-password', asyncHandler(async (req, res) => {
    const password = newTeamPassword();
    const hash = hashTeamPassword(password);
    await repos.updateOrganization(req.user.orgId, {
      devicePasswordHash: hash,
      devicePasswordCreatedAt: new Date(),
    });
    const org = await repos.getOrganizationById(req.user.orgId);
    await audit(req, 'regenerate_device_password', 'organization', String(req.user.orgId), null, { createdAt: org.devicePasswordCreatedAt });
    res.json({ password, generatedAt: org.devicePasswordCreatedAt });
  }));

  // GET /api/team/esp32-devices/password — generate it the first time (plain,
  // once); afterwards just report that one exists without showing it.
  router.get('/password', asyncHandler(async (req, res) => {
    const org = await repos.getOrganizationById(req.user.orgId);
    if (org?.devicePasswordHash) {
      return res.json({ configured: true, firstTime: false, generatedAt: org.devicePasswordCreatedAt, password: null });
    }
    const password = newTeamPassword();
    await repos.updateOrganization(req.user.orgId, {
      devicePasswordHash: hashTeamPassword(password),
      devicePasswordCreatedAt: new Date(),
    });
    const updated = await repos.getOrganizationById(req.user.orgId);
    await audit(req, 'create_device_password', 'organization', String(req.user.orgId), null, { createdAt: updated.devicePasswordCreatedAt });
    res.json({ configured: true, firstTime: true, generatedAt: updated.devicePasswordCreatedAt, password });
  }));

  return router;
}