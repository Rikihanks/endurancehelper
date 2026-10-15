import express from 'express';
import { appError } from '../errors.js';
import { asyncHandler, rateLimit } from '../server/middleware.js';

const VALID_COMMANDS = [
  'box',
  'pos',
  'lapsRace',
  'lapsUntilBox',
  'deltaObjetiveTimeIntermediate',
  'deltaObjetiveTimeBad',
  'deltaObjetiveTimeGood',
  'distanceToPilotBehind',
  'distanceToPilotInFront',
];

export function createCommandRoutes({ repos, hub, scheduler }) {
  const router = express.Router();

  router.get('/:deviceId/commands', asyncHandler(async (req, res) => {
    const device = await repos.getEsp32DeviceById(req.user.orgId, req.params.deviceId);
    if (!device) throw appError('RESOURCE_NOT_FOUND', 'Device not found');
    const configs = await repos.listCommandConfigs(req.params.deviceId);
    const connected = hub.isEsp32Connected(device.uuid, req.user.orgId);
    res.json({ configs, connected, deviceUuid: device.uuid });
  }));

  router.put('/:deviceId/commands', asyncHandler(async (req, res) => {
    const device = await repos.getEsp32DeviceById(req.user.orgId, req.params.deviceId);
    if (!device) throw appError('RESOURCE_NOT_FOUND', 'Device not found');

    const { commandType, commandText, intervalMs, enabled } = req.body || {};
    if (!commandType || typeof commandType !== 'string') {
      throw appError('VALIDATION_ERROR', 'commandType is required');
    }
    if (!VALID_COMMANDS.includes(commandType) && commandType !== 'raw') {
      throw appError('VALIDATION_ERROR', `Invalid commandType. Valid: ${VALID_COMMANDS.join(', ')}, raw`);
    }

    const config = await repos.upsertCommandConfig({
      deviceId: req.params.deviceId,
      commandType,
      commandText: String(commandText ?? ''),
      intervalMs: intervalMs != null ? Number(intervalMs) : null,
      enabled: enabled !== false,
    });

    await scheduler.reloadAll();
    res.json({ config });
  }));

  router.delete('/:deviceId/commands/:commandType', asyncHandler(async (req, res) => {
    const device = await repos.getEsp32DeviceById(req.user.orgId, req.params.deviceId);
    if (!device) throw appError('RESOURCE_NOT_FOUND', 'Device not found');
    await repos.deleteCommandConfig(req.params.deviceId, req.params.commandType);
    await scheduler.reloadAll();
    res.json({ ok: true });
  }));

  router.post('/:deviceId/send-command', asyncHandler(async (req, res) => {
    const device = await repos.getEsp32DeviceById(req.user.orgId, req.params.deviceId);
    if (!device) throw appError('RESOURCE_NOT_FOUND', 'Device not found');

    const { commandType, commandText } = req.body || {};
    if (!commandType) throw appError('VALIDATION_ERROR', 'commandType is required');

    const payload = { type: commandType, text: String(commandText ?? '') };
    const sent = hub.sendToDevice(device.uuid, payload, req.user.orgId);
    if (sent) {
      repos.logEsp32Device({ deviceId: device.id, orgId: req.user.orgId, event: 'command_sent', detail: `${commandType}: ${commandText}` }).catch(() => {});
    }
    res.json({ sent, deviceUuid: device.uuid });
  }));

  router.post('/send-to-driver', asyncHandler(async (req, res) => {
    const { driverName, commandType, commandText } = req.body || {};
    if (!driverName || typeof driverName !== 'string') {
      throw appError('VALIDATION_ERROR', 'driverName is required');
    }
    if (!commandType || typeof commandType !== 'string') {
      throw appError('VALIDATION_ERROR', 'commandType is required');
    }

    const device = await repos.getEsp32DeviceByPilotName(req.user.orgId, driverName.trim());
    if (!device) {
      throw appError('RESOURCE_NOT_FOUND', `No hay InLapBox registrado para el piloto "${driverName}"`);
    }

    const payload = { type: commandType, text: String(commandText ?? '') };
    const sent = hub.sendToDevice(device.uuid, payload, req.user.orgId);
    if (sent) {
      repos.logEsp32Device({ deviceId: device.id, orgId: req.user.orgId, event: 'command_sent', detail: `${commandType}: ${commandText} (to ${driverName})` }).catch(() => {});
    }
    res.json({ sent, deviceUuid: device.uuid, pilotName: device.pilotName });
  }));

  const broadcastGuard = rateLimit({ windowMs: 10000, max: 10, name: 'esp32-broadcast' });
  router.post('/broadcast-command', broadcastGuard, asyncHandler(async (req, res) => {
    const { commandType, commandText } = req.body || {};
    if (!commandType) throw appError('VALIDATION_ERROR', 'commandType is required');
    const payload = { type: commandType, text: String(commandText ?? '') };
    const sent = hub.sendToOrgDevices(req.user.orgId, payload);
    res.json({ sent });
  }));

  router.get('/:deviceId/commands/logs', asyncHandler(async (req, res) => {
    const device = await repos.getEsp32DeviceById(req.user.orgId, req.params.deviceId);
    if (!device) throw appError('RESOURCE_NOT_FOUND', 'Device not found');
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const logs = await repos.listDeviceLogs(req.params.deviceId, { limit, offset });
    res.json({ logs });
  }));

  router.get('/logs', asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const logs = await repos.listOrgDeviceLogs(req.user.orgId, { limit, offset });
    res.json({ logs });
  }));

  return router;
}

export { VALID_COMMANDS };
