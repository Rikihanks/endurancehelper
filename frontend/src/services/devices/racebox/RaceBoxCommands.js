// RaceBox memory / standalone-recording commands (classes 0xFF).
//
// Structures follow the official RaceBox BLE Protocol rev 9 and the reference
// client (lgnap/RaceBoxMicroBleClient). We only ever send documented commands;
// nothing here invents payloads.
//
// Command     | Dir    | Payload
// 0xFF/0x22   | out    | empty            -> status query
// 0xFF/0x30   | out    | 4 bytes LE code  -> unlock memory
// 0xFF/0x23   | out    | empty            -> start history download
// 0xFF/0x23   | out    | 1 byte           -> cancel download
// 0xFF/0x24   | out    | empty            -> erase memory (irreversible)
// 0xFF/0x24   | out    | 1 byte           -> cancel erase
// 0xFF/0x25   | out    | 12 bytes         -> recording config (start/stop)
// Responses arrive on the TX characteristic and are decoded by RaceBoxDecoder.

import {
  encodeFrame,
  UBX_CLASS_RACEBOX,
  RACEBOX_ID,
} from './RaceBoxProtocol.js';

/** Default factory security code for RaceBox Mini S / Micro. */
export const DEFAULT_SECURITY_CODE = 123456;

function u32le(value) {
  const v = value >>> 0;
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
}

function u16le(value) {
  const v = value & 0xffff;
  return [v & 0xff, (v >> 8) & 0xff];
}

/** Status query: 0xFF/0x22, empty payload. */
export function buildStatusQuery() {
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.REC_STATUS, []);
}

/** Memory unlock: 0xFF/0x30 with the 4-byte LE security code. */
export function buildUnlock(code = DEFAULT_SECURITY_CODE) {
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.MEM_UNLOCK, u32le(code));
}

/** Start history download: 0xFF/0x23, empty payload. */
export function buildDownloadStart() {
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.DOWNLOAD, []);
}

/** Cancel history download: 0xFF/0x23 with a single (ignored) byte. */
export function buildDownloadCancel() {
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.DOWNLOAD, [0x00]);
}

/** Erase stored memory: 0xFF/0x24, empty payload. Irreversible. */
export function buildEraseStart() {
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.ERASE, []);
}

/** Cancel an ongoing erase: 0xFF/0x24 with a single byte. */
export function buildEraseCancel() {
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.ERASE, [0x00]);
}

/**
 * Recording config / start-stop: 0xFF/0x25, 12-byte payload.
 *   [0]     enable (1 start, 0 stop)
 *   [1]     data rate Hz (1/5/10/25)
 *   [2]     flags: bit0 wait-for-fix, bit1 stationary, bit2 no-fix, bit3 auto-shutdown
 *   [3]     reserved
 *   [4..5]  stationary speed threshold (UInt16 LE, mm/s)
 *   [6..7]  stationary interval (UInt16 LE, s)
 *   [8..9]  no-fix interval (UInt16 LE, s)
 *   [10..11] auto-shutdown interval (UInt16 LE, s)
 */
export function buildRecordingCommand({
  enable,
  rateHz = 25,
  stationaryFilter = false,
  noFixFilter = false,
  autoShutdownMin = 0,
  stationarySpeedMmS = 1389,
  stationaryIntervalS = 30,
  noFixIntervalS = 30,
} = {}) {
  const payload = new Array(12).fill(0);
  payload[0] = enable ? 1 : 0;
  payload[1] = rateHz & 0xff;

  let flags = 0;
  if (stationaryFilter) flags |= 1 << 1;
  if (noFixFilter) flags |= 1 << 2;
  if (autoShutdownMin) flags |= 1 << 3;
  payload[2] = flags;

  if (stationaryFilter) {
    const [a, b] = u16le(stationarySpeedMmS);
    payload[4] = a;
    payload[5] = b;
    const [c, d] = u16le(stationaryIntervalS);
    payload[6] = c;
    payload[7] = d;
  }
  if (noFixFilter) {
    const [a, b] = u16le(noFixIntervalS);
    payload[8] = a;
    payload[9] = b;
  }
  if (autoShutdownMin) {
    const [a, b] = u16le(autoShutdownMin * 60);
    payload[10] = a;
    payload[11] = b;
  }
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.REC_CONFIG, payload);
}

// ── Response parsers ─────────────────────────────────────────────────────────

function readU32(p, o) {
  return (
    (p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] << 24)) >>> 0
  );
}

/**
 * 0xFF/0x22 response, 12-byte payload.
 * @param {Uint8Array} payload
 */
export function parseMemoryStatus(payload) {
  if (!payload || payload.length < 4) return null;
  const security = payload[2] || 0;
  return {
    recording: (payload[0] || 0) !== 0,
    recordingState: payload[0] || 0,
    memoryPercent: payload[1] || 0,
    securityEnabled: (security & 0x01) === 0x01,
    unlocked: (security & 0x02) === 0x02,
    recordCount: payload.length >= 8 ? readU32(payload, 4) : null,
    memorySize: payload.length >= 12 ? readU32(payload, 8) : null,
  };
}

/**
 * 0xFF/0x23 response: 4-byte expected history message count.
 * @param {Uint8Array} payload
 */
export function parseExpectedCount(payload) {
  if (!payload || payload.length < 4) return null;
  return readU32(payload, 0);
}

/**
 * 0xFF/0x26 state change (recording session boundary).
 * @param {Uint8Array} payload
 */
export function parseStateChange(payload) {
  if (!payload || payload.length < 1) return null;
  return {
    state: payload[0] || 0, // 0 disabled, 1 running, 2 paused
    rateHz: payload.length >= 3 ? payload[2] || 0 : 0,
    flags: payload.length >= 4 ? payload[3] || 0 : 0,
  };
}

/**
 * ACK/NACK payload: [class, id] of the command being acknowledged.
 * @param {Uint8Array} payload
 */
export function parseAckTarget(payload) {
  if (!payload || payload.length < 2) return null;
  return { cls: payload[0], id: payload[1] };
}

/** Human label for a command id (diagnostics). */
export const COMMAND_LABELS = Object.freeze({
  [RACEBOX_ID.ACK]: 'ACK',
  [RACEBOX_ID.NACK]: 'NACK',
  [RACEBOX_ID.REC_STATUS]: 'Estado de memoria',
  [RACEBOX_ID.DOWNLOAD]: 'Descarga de historial',
  [RACEBOX_ID.ERASE]: 'Borrado de memoria',
  [RACEBOX_ID.REC_CONFIG]: 'Configuración de grabación',
  [RACEBOX_ID.STATE_CHANGE]: 'Cambio de estado de grabación',
  [RACEBOX_ID.MEM_UNLOCK]: 'Desbloqueo de memoria',
});
