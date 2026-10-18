// RaceBox payload decoder: raw 80-byte payload -> typed RaceBoxRecord.
//
// Offsets follow the reference client (RaceBox BLE Protocol rev 8),
// RaceBoxParser.cpp. See docs/racebox-protocol-research.md §2.3.
//
// The decoder is defensive: it never throws on malformed input, it returns
// null and counts the rejection instead, so a single bad packet cannot stall
// the receive loop.

import {
  RACEBOX_PAYLOAD_LEN,
  RACEBOX_ID,
  UBX_CLASS_RACEBOX,
  UbxFrameParser,
} from './RaceBoxProtocol.js';
import {
  LATLON_SCALE,
  ALT_MM_SCALE,
  MMPS_TO_KMH,
  HEADING_SCALE,
} from './RaceBoxTypes.js';

function i32(p, o) {
  return ((p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] << 24)) | 0);
}
function u32(p, o) {
  return (p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] << 24)) >>> 0;
}
function u16(p, o) {
  return p[o] | (p[o + 1] << 8);
}
function i16(p, o) {
  const v = p[o] | (p[o + 1] << 8);
  return (v << 16) >> 16;
}

/**
 * Decode an 80-byte RaceBox data payload (LIVE 0x01 or HISTORY 0x21).
 * @param {Uint8Array} p
 * @param {number} [receivedAt]
 * @returns {import('./RaceBoxTypes.js').RaceBoxRecord|null}
 */
export function decodePayload(p, receivedAt = Date.now()) {
  if (!p || p.length < RACEBOX_PAYLOAD_LEN) return null;

  const lon = i32(p, 24) * LATLON_SCALE;
  const lat = i32(p, 28) * LATLON_SCALE;
  // Reject clearly out-of-range coordinates as malformed rather than display
  // nonsense (a valid GPS fix is always within these bounds).
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const batteryByte = p[67];

  return {
    iTOW: u32(p, 0),
    year: u16(p, 4),
    month: p[6],
    day: p[7],
    hour: p[8],
    minute: p[9],
    second: p[10],
    validityFlags: p[11],
    timeAccuracyNs: u32(p, 12),
    nanoseconds: i32(p, 16),
    fixStatus: p[20],
    fixFlags: p[21],
    dateTimeFlags: p[22],
    numSVs: p[23],
    longitude: lon,
    latitude: lat,
    wgsAltitude: i32(p, 32) * ALT_MM_SCALE,
    altitude: i32(p, 36) * ALT_MM_SCALE,
    horizontalAccuracy: u32(p, 40) * ALT_MM_SCALE,
    verticalAccuracy: u32(p, 44) * ALT_MM_SCALE,
    speed: i32(p, 48) * MMPS_TO_KMH,
    heading: i32(p, 52) * HEADING_SCALE,
    speedAccuracy: u32(p, 56) * MMPS_TO_KMH,
    headingAccuracy: u32(p, 60) * HEADING_SCALE,
    pdop: u16(p, 64),
    latLonFlags: p[66],
    gForceX: i16(p, 68),
    gForceY: i16(p, 70),
    gForceZ: i16(p, 72),
    rotRateX: i16(p, 74),
    rotRateY: i16(p, 76),
    rotRateZ: i16(p, 78),
    batteryLevel: batteryByte & 0x7f,
    charging: (batteryByte & 0x80) !== 0,
    receivedAt,
  };
}

/**
 * Decode a validated frame into a typed message. Returns null for frames we do
 * not understand or for malformed live/history payloads.
 * @param {import('./RaceBoxTypes.js').RawFrame} frame
 * @returns {import('./RaceBoxTypes.js').DecodedMessage|null}
 */
export function decodeFrame(frame) {
  if (!frame || frame.cls !== UBX_CLASS_RACEBOX) return null;
  switch (frame.id) {
    case RACEBOX_ID.LIVE: {
      const record = decodePayload(frame.payload);
      return record ? { kind: 'live', id: frame.id, record } : null;
    }
    case RACEBOX_ID.HISTORY: {
      const record = decodePayload(frame.payload);
      return record ? { kind: 'history', id: frame.id, record } : null;
    }
    case RACEBOX_ID.ACK:
      return { kind: 'ack', id: frame.id, payload: frame.payload };
    case RACEBOX_ID.NACK:
      return { kind: 'nack', id: frame.id, payload: frame.payload };
    case RACEBOX_ID.REC_STATUS:
      return { kind: 'status', id: frame.id, payload: frame.payload };
    case RACEBOX_ID.DOWNLOAD:
      return { kind: 'download', id: frame.id, payload: frame.payload };
    case RACEBOX_ID.ERASE:
      return { kind: 'erase', id: frame.id, payload: frame.payload };
    case RACEBOX_ID.REC_CONFIG:
      return { kind: 'recConfig', id: frame.id, payload: frame.payload };
    case RACEBOX_ID.STATE_CHANGE:
      return { kind: 'stateChange', id: frame.id, payload: frame.payload };
    default:
      return { kind: 'unknown', id: frame.id, payload: frame.payload };
  }
}

/**
 * High-level stream decoder: feed it raw notification bytes and it returns
 * decoded messages, tracking frame/decoding counters for diagnostics.
 */
export class RaceBoxStreamDecoder {
  constructor() {
    this._parser = new UbxFrameParser();
    this.framesReceived = 0;
    this.recordsDecoded = 0;
    this.decodeErrors = 0;
    this.lastFrameAt = 0;
    /** @type {Uint8Array|null} Last complete valid frame (for diagnostics). */
    this.lastFrame = null;
  }

  reset() {
    this._parser.reset();
  }

  get pendingBytes() {
    return this._parser.pendingBytes;
  }

  /**
   * @param {Uint8Array} chunk
   * @returns {import('./RaceBoxTypes.js').DecodedMessage[]}
   */
  push(chunk) {
    /** @type {import('./RaceBoxTypes.js').DecodedMessage[]} */
    const out = [];
    const frames = this._parser.push(chunk);
    for (const frame of frames) {
      this.framesReceived += 1;
      this.lastFrameAt = Date.now();
      this.lastFrame = frame.frame;
      const msg = decodeFrame(frame);
      if (msg) {
        if (msg.record) this.recordsDecoded += 1;
        out.push(msg);
      } else {
        this.decodeErrors += 1;
      }
    }
    return out;
  }
}
