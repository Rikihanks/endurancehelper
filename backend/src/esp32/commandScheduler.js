// Driver-aware command scheduler for ESP32 InLapBox devices.
//
// Instead of one timer per config, this scheduler runs a single tick every
// second and resolves WHICH device to send to based on who is currently driving.
//
// Flow per tick:
//   1. For each active race session -> who is driving? (manualDriverIdx or auto)
//   2. driverName -> esp32_devices.pilot_name -> device UUID
//   3. device -> esp32_command_configs -> personalized command configs
//   4. For each config: if intervalMs has elapsed -> send to that device
//
// Each pilot has their OWN InLapBox with personalized settings:
//   Juan: pos cada 5s, lapsRace cada 10s
//   Pedro: pos cada 2s, box cada 30s
// The scheduler sends the RIGHT config to the RIGHT box based on who is driving.

import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'esp32-scheduler' });
const TICK_MS = 1000;

export function createCommandScheduler({ repos, hub, manager }) {
  const lastSent = new Map(); // deviceId -> { commandType -> lastSentAt }
  let tickTimer = null;

  function start() {
    tickTimer = setInterval(tick, TICK_MS);
    log.info('scheduler started (driver-aware, 1s tick)');
  }

  function stop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    lastSent.clear();
    log.info('scheduler stopped');
  }

  function reloadAll() {
    lastSent.clear();
    log.debug('scheduler timers reset');
  }

  async function tick() {
    try {
      const all = manager.list();
      if (all.length > 0) {
        log.debug(`tick: ${all.length} session(s) in manager: ${all.map((s) => `${s.id.slice(0,8)}(${s.orgId.slice(0,8)})`).join(', ')}`);
      }
      const sessions = all.filter((s) => s.status === 'running');
      for (const session of sessions) {
        const orgId = session.orgId;
        if (orgId === 'local') continue;

        const rt = manager.getSession(session.id);
        if (!rt) { log.debug(`tick: session ${session.id.slice(0,8)} no runtime`); continue; }

        const drivers = rt.config.race.drivers || [];

        // Who is driving right now?
        const driverIdx = rt.config.race.manualDriverIdx;
        const driverName = driverIdx >= 0 ? drivers[driverIdx]?.name : null;
        log.debug(`tick: session ${session.id.slice(0,8)} driverIdx=${driverIdx} driverName="${driverName}" drivers=${drivers.length}`);
        if (!driverName) continue;

        // Which device belongs to this driver?
        const device = await repos.getEsp32DeviceByPilotName(orgId, driverName);
        if (!device) {
          log.debug(`tick: no device for pilot "${driverName}" in org ${orgId.slice(0,8)}`);
          continue;
        }
        const connected = hub.isEsp32Connected(device.uuid, orgId);
        if (!connected) {
          log.debug(`tick: device ${device.uuid} (pilot=${driverName}) not connected`);
          continue;
        }

        // What are this device's personalized command configs?
        const configs = await repos.getScheduledConfigsForDevice(device.id);
        if (configs.length === 0) {
          log.debug(`tick: device ${device.uuid} has no scheduled configs`);
          continue;
        }

        // Send each config if its interval has elapsed
        const now = Date.now();
        for (const cfg of configs) {
          const deviceTimers = lastSent.get(device.id) || {};
          const last = deviceTimers[cfg.commandType] || 0;

          if (now - last >= cfg.intervalMs) {
            const payload = { type: cfg.commandType, text: cfg.commandText };
            const sent = hub.sendToDevice(device.uuid, payload, orgId);
            if (sent) {
              deviceTimers[cfg.commandType] = now;
              lastSent.set(device.id, deviceTimers);
            }
          }
        }
      }
    } catch (e) {
      log.error('scheduler tick error', { error: e.message });
    }
  }

  return { start, stop, reloadAll };
}
