// WebSocket hub: room-based broadcast + per-device ESP32 targeting.
//
// Browser clients join `race:<raceSessionId>` and receive state snapshots.
// ESP32 devices join `esp32:<orgId>` (team room) and are also tracked in a
// Map<uuid, { ws, orgId }> for direct command delivery.
//
// SECURITY: sendToDevice() requires expectedOrgId to prevent cross-team
// command injection. The caller must prove the device belongs to their org
// (via DB lookup in the route handler) before calling this method.

export class WsHub {
  constructor(wss) {
    this.wss = wss;
    this.esp32Devices = new Map(); // uuid -> { ws, orgId }
  }

  joinRoom(ws, room) {
    if (!ws.rooms) ws.rooms = new Set();
    ws.rooms.add(room);
  }

  registerEsp32(uuid, ws, orgId) {
    this.esp32Devices.set(uuid, { ws, orgId });
  }

  unregisterEsp32(uuid) {
    this.esp32Devices.delete(uuid);
  }

  isEsp32Connected(uuid, expectedOrgId) {
    const entry = this.esp32Devices.get(uuid);
    if (!entry || entry.ws.readyState !== entry.ws.OPEN) return false;
    if (expectedOrgId && entry.orgId !== expectedOrgId) return false;
    return true;
  }

  sendToDevice(uuid, payload, expectedOrgId) {
    const entry = this.esp32Devices.get(uuid);
    if (!entry || entry.ws.readyState !== entry.ws.OPEN) return false;
    if (expectedOrgId && entry.orgId !== expectedOrgId) {
      console.warn(`[wsHub] blocked sendToDevice: org mismatch (device=${uuid}, expected=${expectedOrgId}, actual=${entry.orgId})`);
      return false;
    }
    const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    entry.ws.send(msg);
    return true;
  }

  sendToOrgDevices(orgId, payload) {
    const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    let sent = 0;
    for (const ws of this.wss.clients) {
      if (ws.readyState === ws.OPEN && ws.rooms && ws.rooms.has(`esp32:${orgId}`)) {
        ws.send(msg);
        sent++;
      }
    }
    return sent;
  }

  listConnectedOrgDevices(orgId) {
    const result = [];
    for (const ws of this.wss.clients) {
      if (ws.readyState === ws.OPEN && ws.rooms && ws.rooms.has(`esp32:${orgId}`) && ws._ctx?.esp32Uuid) {
        result.push(ws._ctx.esp32Uuid);
      }
    }
    return result;
  }

  disconnectOrgEsp32(orgId) {
    let disconnected = 0;
    for (const ws of this.wss.clients) {
      if (ws.readyState === ws.OPEN && ws.rooms && ws.rooms.has(`esp32:${orgId}`) && ws._ctx?.kind === 'esp32') {
        ws.close(4000, 'race_finished');
        disconnected++;
      }
    }
    return disconnected;
  }

  notifyOrgEsp32Status(orgId, event, detail) {
    const msg = JSON.stringify({ type: 'esp32_status', event, detail, ts: Date.now() });
    for (const ws of this.wss.clients) {
      if (ws.readyState === ws.OPEN && ws._ctx?.orgId === orgId && ws._ctx?.kind !== 'esp32') {
        ws.send(msg);
      }
    }
  }

  broadcast(room, snapshot) {
    const payload = JSON.stringify({ type: 'state', data: snapshot });
    for (const ws of this.wss.clients) {
      if (ws.readyState === ws.OPEN && ws.rooms && ws.rooms.has(room)) {
        ws.send(payload);
      }
    }
  }
}
