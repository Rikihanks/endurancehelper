// Thin, dumb API client. The frontend never computes anything: it sends raw
// inputs to the backend and renders whatever the backend's view model contains.
//
// License enforcement (spec 16): a 402 anywhere in the app closes the live
// connection and shows the license screen. The backend remains the authority.
//
// VITE_API_BASE: when deploying the frontend separately (e.g. Netlify) point it
// at the backend, e.g. VITE_API_BASE=https://api.tudominio.com. Leave empty for
// same-origin (dev proxy / backend serving the static build).

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

function apiUrl(path) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

function wsUrl(path) {
  if (API_BASE) {
    const u = new URL(API_BASE);
    return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}${path}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${path}`;
}

const licenseRequiredHandlers = new Set();

export function onLicenseRequired(handler) {
  licenseRequiredHandlers.add(handler);
  return () => licenseRequiredHandlers.delete(handler);
}

function triggerLicenseRequired() {
  for (const h of licenseRequiredHandlers) {
    try { h(); } catch (_) { /* handler must not break the request */ }
  }
}

async function request(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    credentials: API_BASE ? 'include' : 'same-origin',
    ...options,
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    /* empty body */
  }
  if (res.status === 402) triggerLicenseRequired();
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  get: (path) => request(path),
  post: (path, data = {}) =>
    request(path, { method: 'POST', body: JSON.stringify(data) }),
  put: (path, data = {}) =>
    request(path, { method: 'PUT', body: JSON.stringify(data) }),
  patch: (path, data = {}) =>
    request(path, { method: 'PATCH', body: JSON.stringify(data) }),
  del: (path) => request(path, { method: 'DELETE' }),
};

export function getSetupStatus() {
  return api.get('/api/setup-status');
}

export function getConfig(sessionId) {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return api.get(`/api/config${q}`);
}

export function saveConfig(data, sessionId) {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return api.post(`/api/config${q}`, data);
}

export function saveSetup(data) {
  return api.post('/api/setup', data);
}

export function getCircuit() {
  return api.get('/api/circuit');
}

export function setCircuit(url, sessionId) {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return api.post(`/api/circuit${q}`, { url });
}

export function toggleOffline(enabled, sessionId) {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return api.post(`/api/offline${q}`, { enabled });
}

export function captureQualy(sessionId) {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return api.post(`/api/qualy${q}`);
}

export function clearQualy(sessionId) {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return api.del(`/api/qualy${q}`);
}

// ---- Auth (Fase 2) ----
export function googleLogin(credential) {
  return api.post('/api/auth/google', { credential });
}

export function logout() {
  return api.post('/api/auth/logout');
}

export function getMe() {
  return api.get('/api/auth/me');
}

// ---- Billing (one product, monthly | annual) ----
export function createCheckout(interval) {
  return api.post('/api/billing/checkout', { interval });
}

// ---- Dev-only (enabled when NODE_ENV !== production) ----
export function grantDevLicense(interval) {
  return api.post('/api/dev/license', { interval });
}

// ---- Organizations / onboarding ----
export function onboardOrg(data) {
  return api.post('/api/organizations', data);
}

export function getMyOrg() {
  return api.get('/api/organizations/me');
}

export function renameOrg(data) {
  return api.put('/api/organizations/me', data);
}

export function getMyLicense() {
  return api.get('/api/organizations/me/license');
}

// ---- InLap Box (ESP32) team device management ----
export function listEsp32Devices() {
  return api.get('/api/team/esp32-devices');
}

export function deleteEsp32Device(id) {
  return api.del(`/api/team/esp32-devices/${encodeURIComponent(id)}`);
}

export function getOrCreateEsp32Password() {
  return api.get('/api/team/esp32-devices/password');
}

export function regenerateEsp32Password() {
  return api.post('/api/team/esp32-devices/regenerate-password');
}

export function registerEsp32Device(data) {
  return api.post('/api/team/esp32-devices', data);
}

export function getEsp32DeviceToken(id) {
  return api.post(`/api/team/esp32-devices/${encodeURIComponent(id)}/token`);
}

export function updateEsp32Device(id, data) {
  return api.patch(`/api/team/esp32-devices/${encodeURIComponent(id)}`, data);
}

export function listDeviceCommands(deviceId) {
  return api.get(`/api/team/esp32-devices/${encodeURIComponent(deviceId)}/commands`);
}

export function saveDeviceCommand(deviceId, config) {
  return api.put(`/api/team/esp32-devices/${encodeURIComponent(deviceId)}/commands`, config);
}

export function deleteDeviceCommand(deviceId, commandType) {
  return api.del(`/api/team/esp32-devices/${encodeURIComponent(deviceId)}/commands/${encodeURIComponent(commandType)}`);
}

export function sendDeviceCommand(deviceId, commandType, commandText) {
  return api.post(`/api/team/esp32-devices/${encodeURIComponent(deviceId)}/send-command`, { commandType, commandText });
}

export function sendCommandToDriver(driverName, commandType, commandText) {
  return api.post('/api/team/esp32-devices/send-to-driver', { driverName, commandType, commandText });
}

export function broadcastDeviceCommand(commandType, commandText) {
  return api.post('/api/team/esp32-devices/broadcast-command', { commandType, commandText });
}

export function listDeviceLogs(deviceId, { limit, offset } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const s = params.toString();
  return api.get(`/api/team/esp32-devices/${encodeURIComponent(deviceId)}/commands/logs${s ? `?${s}` : ''}`);
}

export function listOrgDeviceLogs({ limit, offset } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const s = params.toString();
  return api.get(`/api/team/esp32-devices/logs${s ? `?${s}` : ''}`);
}

// ---- Org-level team/member management (owner + org admin) ----
export function listMembers() {
  return api.get('/api/organizations/me/members');
}

export function addMember(email, role) {
  return api.post('/api/organizations/me/members', { email, role });
}

export function setMemberRole(userId, role) {
  return api.put(`/api/organizations/me/members/${userId}`, { role });
}

export function removeMember(userId) {
  return api.del(`/api/organizations/me/members/${userId}`);
}

// ---- GLOBAL admin panel (platform-wide; /api/admin) ----
export const adminApi = {
  // users
  listUsers: (search) => api.get(`/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createUser: (email, name) => api.post('/api/admin/users', { email, name }),
  promoteUser: (id) => api.post(`/api/admin/users/${id}/promote`),
  demoteUser: (id) => api.post(`/api/admin/users/${id}/demote`),
  deactivateUser: (id) => api.post(`/api/admin/users/${id}/deactivate`),
  activateUser: (id) => api.post(`/api/admin/users/${id}/activate`),
  revokeSessions: (id) => api.post(`/api/admin/users/${id}/revoke-sessions`),
  deleteUser: (id) => api.del(`/api/admin/users/${id}`),

  // orgs
  listOrgs: () => api.get('/api/admin/orgs'),
  getOrg: (id) => api.get(`/api/admin/orgs/${id}`),
  createOrg: (name, ownerEmail) => api.post('/api/admin/orgs', { name, ownerEmail }),
  renameOrg: (id, name) => api.put(`/api/admin/orgs/${id}`, { name }),
  transferOwner: (id, userId) => api.post(`/api/admin/orgs/${id}/transfer-owner`, { userId }),
  deleteOrg: (id) => api.del(`/api/admin/orgs/${id}`),

  // members (any org)
  addOrgMember: (orgId, email, role) => api.post(`/api/admin/orgs/${orgId}/members`, { email, role }),
  setOrgMemberRole: (orgId, userId, role) => api.put(`/api/admin/orgs/${orgId}/members/${userId}`, { role }),
  removeOrgMember: (orgId, userId) => api.del(`/api/admin/orgs/${orgId}/members/${userId}`),

  // licenses
  listLicenses: () => api.get('/api/admin/licenses'),
  createLicense: (orgId, data) => api.post(`/api/admin/orgs/${orgId}/license`, data),
  updateLicense: (orgId, data) => api.put(`/api/admin/orgs/${orgId}/license`, data),
  deleteLicense: (orgId) => api.del(`/api/admin/orgs/${orgId}/license`),

  // ESP32 devices (all teams)
  listDevices: (orgId, q) => {
    const params = new URLSearchParams();
    if (orgId) params.set('orgId', orgId);
    if (q) params.set('q', q);
    const s = params.toString();
    return api.get(`/api/admin/devices${s ? `?${s}` : ''}`);
  },
  deleteDevice: (id) => api.del(`/api/admin/devices/${id}`),
  listOrgDevices: (orgId) => api.get(`/api/admin/orgs/${orgId}/devices`),
  regenerateOrgDevicePassword: (orgId) => api.post(`/api/admin/orgs/${orgId}/device-password`),

  // audit trail
  logs: () => api.get('/api/admin/logs'),
};

// ---- Race configs (Fase 5) ----
export function listRaceConfigs() {
  return api.get('/api/race-configs');
}

export function createRaceConfig(data) {
  return api.post('/api/race-configs', data);
}

export function getRaceConfig(id) {
  return api.get(`/api/race-configs/${id}`);
}

export function updateRaceConfig(id, data) {
  return api.put(`/api/race-configs/${id}`, data);
}

export function deleteRaceConfig(id) {
  return api.del(`/api/race-configs/${id}`);
}

// ---- Race sessions (Fase 5) ----
export function listRaceSessions() {
  return api.get('/api/race-sessions');
}

export function startRaceSession(raceConfigId) {
  return api.post('/api/race-sessions', { raceConfigId });
}

export function getRaceSession(id) {
  return api.get(`/api/race-sessions/${id}`);
}

export function getRaceSessionState(id) {
  return api.get(`/api/race-sessions/${id}/state`);
}

export function getRaceSessionReport(id) {
  return api.get(`/api/race-sessions/${id}/report`);
}

export function finishRaceSession(id) {
  return api.post(`/api/race-sessions/${id}/finish`);
}

export function deleteRaceSession(id) {
  return api.del(`/api/race-sessions/${id}`);
}

// Connect to the backend live stream for a specific race session. `onState`
// receives the raw snapshot (already containing the pre-formatted `view`).
// Auto-reconnects.
export function connectLive(onState, raceSessionId, onEvent) {
  let ws = null;
  let closedByUser = false;

  function open() {
    ws = new WebSocket(wsUrl(raceSessionId ? `/ws?raceSessionId=${encodeURIComponent(raceSessionId)}` : '/ws'));

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') onState(msg.data);
        else if (msg.type === 'esp32_status' && onEvent) onEvent(msg);
      } catch (_) {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (!closedByUser) setTimeout(open, 3000);
    };
    ws.onerror = () => ws.close();
  }

  open();
  return () => {
    closedByUser = true;
    if (ws) ws.close();
  };
}
