// WebSocket handshake validation for InLap Box (ESP32) devices.
//
// Two auth methods:
//   1. JWT token (existing flow — auto-refresh if expired)
//   2. Team password (new — ESP32 sends the team password as Bearer, UUID in query param)
//      The backend finds the team by password, finds/creates the device, accepts the connection.
import { bearerToken, verifyEsp32Token, signEsp32Token, verifyEsp32TokenIgnoreExpiry } from './token.js';
import { verifyTeamPassword } from './password.js';

function authorizer(repos) {
  return async function resolveEsp32WsContext(req) {
    const token = bearerToken(req.headers?.authorization || '');
    if (!token) return { error: 'unauthenticated', code: 4401 };

    // --- Path 1: JWT token ---
    let payload = verifyEsp32Token(token);
    if (payload) {
      const device = await repos.getEsp32DeviceByOrgAndUuid(payload.orgId, payload.esp32Uuid);
      if (!device || device.approved !== true) return { error: 'device_revoked', code: 4403 };
      return {
        ok: true, orgId: payload.orgId, esp32Uuid: payload.esp32Uuid,
        deviceId: device.id, newToken: null,
      };
    }

    // JWT expired but signature valid → auto-refresh
    payload = verifyEsp32TokenIgnoreExpiry(token);
    if (payload) {
      const device = await repos.getEsp32DeviceByOrgAndUuid(payload.orgId, payload.esp32Uuid);
      if (!device || device.approved !== true) return { error: 'device_revoked', code: 4403 };
      return {
        ok: true, orgId: payload.orgId, esp32Uuid: payload.esp32Uuid,
        deviceId: device.id,
        newToken: signEsp32Token({ orgId: payload.orgId, esp32Uuid: payload.esp32Uuid }),
      };
    }

    // --- Path 2: Team password ---
    // Extract device UUID from query param ?uuid=XX:XX:XX:XX:XX:XX
    const url = new URL(req.url || '/', 'http://localhost');
    const esp32Uuid = url.searchParams.get('uuid');
    if (!esp32Uuid) return { error: 'unauthenticated', code: 4401 };

    // Find org with matching team password
    const orgs = await repos.listOrgs();
    let team = null;
    for (const org of orgs) {
      if (!org.devicePasswordHash) continue;
      if (verifyTeamPassword(token, org.devicePasswordHash)) {
        team = org;
        break;
      }
    }
    if (!team) return { error: 'unauthenticated', code: 4401 };

    // Find or create device for this team
    let device = await repos.getEsp32DeviceByOrgAndUuid(team.id, esp32Uuid);
    if (!device) {
      const result = await repos.upsertEsp32Device({
        orgId: team.id, uuid: esp32Uuid, deviceName: '', pilotName: '',
      });
      device = result.device;
    }
    if (device.approved !== true) return { error: 'device_revoked', code: 4403 };

    return {
      ok: true, orgId: team.id, esp32Uuid,
      deviceId: device.id, newToken: null,
    };
  };
}

export async function tryEsp32Upgrade({ ws, req, repos, hub }) {
  if (!bearerToken(req.headers?.authorization || '')) return false;
  if (!repos) {
    ws.close(4401, 'esp32_auth_unavailable');
    return true;
  }
  let ctx;
  try {
    ctx = await authorizer(repos)(req);
  } catch (e) {
    console.error('[esp32] authorizer error:', e.message);
    ws.close(4401, 'authorizer_error');
    return true;
  }
  if (!ctx.ok) {
    if (repos) {
      const token = bearerToken(req.headers?.authorization || '');
      const payload = token ? verifyEsp32TokenIgnoreExpiry(token) : null;
      if (payload) {
        const reason = ctx.code === 4403 ? 'device_revoked' : 'auth_failed';
        repos.logEsp32Device({ deviceId: null, orgId: payload.orgId, event: reason, detail: `ws auth rejected: ${ctx.error}` }).catch(() => {});
      }
    }
    ws.close(ctx.code, ctx.error);
    return true;
  }
  ws._ctx = { kind: 'esp32', orgId: ctx.orgId, esp32Uuid: ctx.esp32Uuid };
  hub.joinRoom(ws, `esp32:${ctx.orgId}`);
  hub.registerEsp32(ctx.esp32Uuid, ws, ctx.orgId);
  ws.on('close', () => hub.unregisterEsp32(ctx.esp32Uuid));
  repos.touchEsp32Device(ctx.orgId, ctx.esp32Uuid).catch(() => {});

  const logDetail = ctx.newToken ? 'token auto-refreshed' : 'connected via team password';
  repos.logEsp32Device({ deviceId: ctx.deviceId, orgId: ctx.orgId, event: 'connected', detail: logDetail }).catch(() => {});
  hub.notifyOrgEsp32Status(ctx.orgId, 'connected', ctx.esp32Uuid);

  ws.on('close', () => {
    repos.logEsp32Device({ deviceId: ctx.deviceId, orgId: ctx.orgId, event: 'disconnected' }).catch(() => {});
    hub.notifyOrgEsp32Status(ctx.orgId, 'disconnected', ctx.esp32Uuid);
  });

  const msg = ctx.newToken
    ? { type: 'connected', ok: true, token: ctx.newToken }
    : { type: 'connected', ok: true };
  ws.send(JSON.stringify(msg));
  return true;
}
