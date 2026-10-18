// Full backup / restore of the local data (sessions + tracks) as a single JSON
// file, so a PoC run can be shared between devices or handed over for analysis.
//
// Everything is validated on import: the app never trusts a file blindly.

import { SessionStore } from './SessionStore.js';
import { TrackStore } from './TrackStore.js';

export const BACKUP_APP = 'inlap-racebox';
export const BACKUP_VERSION = 1;

const MAX_SESSIONS = 500;
const MAX_RECORDS_PER_SESSION = 400000;
const MAX_CENTERLINE = 5000;
const MAX_SPLITS = 8;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function numOrNull(v) {
  return isNum(v) ? v : null;
}

function sanitizeTrap(t) {
  if (!t || typeof t !== 'object' || !isNum(t.lat) || !isNum(t.lon)) return null;
  return {
    lat: t.lat,
    lon: t.lon,
    heading: isNum(t.heading) ? t.heading : 0,
    width: isNum(t.width) ? t.width : 20,
    bidirectional: !!t.bidirectional,
    type: t.type === 'startFinish' ? 'startFinish' : 'split',
    name: typeof t.name === 'string' ? t.name : null,
  };
}

function sanitizeTrack(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) return null;
  const centerline = Array.isArray(t.centerline)
    ? t.centerline
        .filter((p) => p && isNum(p.lat) && isNum(p.lon))
        .slice(0, MAX_CENTERLINE)
        .map((p) => ({ lat: p.lat, lon: p.lon }))
    : null;
  return {
    id: t.id,
    name: typeof t.name === 'string' && t.name ? t.name : 'Circuito',
    startFinish: t.startFinish ? sanitizeTrap(t.startFinish) : null,
    splits: Array.isArray(t.splits)
      ? t.splits.map(sanitizeTrap).filter(Boolean).slice(0, MAX_SPLITS)
      : [],
    centerline: centerline && centerline.length ? centerline : null,
    source: typeof t.source === 'string' ? t.source : null,
    builtin: !!t.builtin,
    edited: !!t.edited,
    seedVersion: isNum(t.seedVersion) ? t.seedVersion : null,
  };
}

function sanitizeSession(s) {
  if (!s || typeof s !== 'object') return null;
  if (!Array.isArray(s.records)) return null;
  const records = s.records
    .slice(0, MAX_RECORDS_PER_SESSION)
    .filter((r) => r && typeof r === 'object' && isNum(r.latitude) && isNum(r.longitude));
  if (!records.length) return null;
  const meta = s.meta && typeof s.meta === 'object' ? s.meta : {};
  return {
    id: typeof s.id === 'string' && s.id ? s.id : null,
    meta: {
      name: typeof meta.name === 'string' && meta.name ? meta.name : 'Sesión importada',
      deviceName: typeof meta.deviceName === 'string' ? meta.deviceName : null,
      deviceId: typeof meta.deviceId === 'string' ? meta.deviceId : null,
      source: typeof meta.source === 'string' ? meta.source : 'import',
      startedAt: typeof meta.startedAt === 'string' ? meta.startedAt : null,
      durationS: numOrNull(meta.durationS),
      distanceM: numOrNull(meta.distanceM),
      maxSpeed: numOrNull(meta.maxSpeed),
      maxG: numOrNull(meta.maxG),
      lapCount: numOrNull(meta.lapCount),
      bestLapS: numOrNull(meta.bestLapS),
      createdAt: numOrNull(meta.createdAt) ?? Date.now(),
    },
    records,
  };
}

/** Build the backup object (pure). */
export function buildBackup({ sessions = [], tracks = [], exportedAt = new Date().toISOString() } = {}) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt,
    counts: { sessions: sessions.length, tracks: tracks.length },
    tracks,
    sessions,
  };
}

/**
 * Validate and read a backup file. Accepts a full backup, a single session or a
 * single track (so a session can be shared on its own).
 * @returns {{ tracks: object[], sessions: object[] }}
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error('El archivo no es un JSON válido.');
  }

  if (data && data.app === BACKUP_APP) {
    if (data.version !== BACKUP_VERSION) {
      throw new Error(`Copia de una versión no soportada (${data.version}).`);
    }
    const tracks = (Array.isArray(data.tracks) ? data.tracks : []).map(sanitizeTrack).filter(Boolean);
    const sessions = (Array.isArray(data.sessions) ? data.sessions : [])
      .map(sanitizeSession)
      .filter(Boolean)
      .slice(0, MAX_SESSIONS);
    if (!tracks.length && !sessions.length) {
      throw new Error('La copia no contiene sesiones ni circuitos válidos.');
    }
    return { tracks, sessions };
  }

  const oneSession = sanitizeSession(data);
  if (oneSession) return { tracks: [], sessions: [oneSession] };

  const oneTrack = sanitizeTrack(data);
  if (oneTrack) return { tracks: [oneTrack], sessions: [] };

  throw new Error('El archivo no parece una copia de InLap.');
}

/** Read everything from the local stores and build the backup object. */
export async function exportAll() {
  const metas = await SessionStore.list();
  const sessions = [];
  for (const meta of metas) {
    const full = await SessionStore.get(meta.id);
    if (full) sessions.push(full);
  }
  const tracks = await TrackStore.list();
  const backup = buildBackup({ sessions, tracks });
  return { backup, counts: { sessions: sessions.length, tracks: tracks.length } };
}

/**
 * Import a backup (merge by id: importing the same file twice is harmless).
 * @returns {{ tracks: number, sessions: number }}
 */
export async function importAll(text) {
  const { tracks, sessions } = parseBackup(text);
  for (const track of tracks) {
    await TrackStore.save(track);
  }
  for (const session of sessions) {
    await SessionStore.save({ id: session.id || undefined, meta: session.meta, records: session.records });
  }
  return { tracks: tracks.length, sessions: sessions.length };
}
