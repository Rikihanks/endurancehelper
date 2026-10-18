// RaceBox BLE protocol primitives (device-independent, dependency-free, pure JS).
//
// Framing is UBX-like:
//   sync(2)=0xB5 0x62 | class(1) | id(1) | length(2, LE) | payload(N) | ckA(1) | ckB(1)
// The checksum is Fletcher-16 over [class .. payload] (offset 2, 4 + length bytes).
//
// Source: RaceBox BLE Protocol rev 8 as implemented by the reference client
// github.com/lgnap/RaceBoxMicroBleClient (see docs/racebox-protocol-research.md).
//
// This module only frames/deframes bytes. It makes no assumption about a BLE
// notification containing exactly one packet.

/** @typedef {import('./RaceBoxTypes.js').RawFrame} RawFrame */

// Nordic UART Service (NUS) — used by RaceBox Mini / Mini S / Micro.
export const RACEBOX_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const RACEBOX_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // client -> device
export const RACEBOX_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // device -> client (notify)

export const UBX_SYNC_1 = 0xb5;
export const UBX_SYNC_2 = 0x62;
export const UBX_CLASS_RACEBOX = 0xff;

export const RACEBOX_ID = Object.freeze({
  LIVE: 0x01,
  ACK: 0x02,
  NACK: 0x03,
  HISTORY: 0x21,
  REC_STATUS: 0x22,
  DOWNLOAD: 0x23,
  ERASE: 0x24,
  REC_CONFIG: 0x25,
  STATE_CHANGE: 0x26,
  GNSS_CONFIG: 0x27,
  MEM_UNLOCK: 0x30,
});

export const UBX_FRAME_OVERHEAD = 8;
export const RACEBOX_PAYLOAD_LEN = 80; // live (0x01) and history (0x21) payload size
export const UBX_MAX_PAYLOAD = 256;

/**
 * Fletcher-16 checksum (mod 256) over data[startIdx .. startIdx+count-1].
 * @param {Uint8Array} data
 * @param {number} startIdx
 * @param {number} count
 * @returns {{ a: number, b: number }}
 */
export function fletcher16(data, startIdx, count) {
  let a = 0;
  let b = 0;
  const end = Math.min(startIdx + count, data.length);
  for (let i = startIdx; i < end; i++) {
    a = (a + data[i]) & 0xff;
    b = (b + a) & 0xff;
  }
  return { a, b };
}

/**
 * Encode a UBX frame. Only used for the documented recording commands (out of
 * PoC scope) and for tests. Never sends unknown commands blindly.
 * @param {number} cls
 * @param {number} id
 * @param {Uint8Array|number[]} payload
 * @returns {Uint8Array}
 */
export function encodeFrame(cls, id, payload = []) {
  const body = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  const len = body.length;
  const frame = new Uint8Array(UBX_FRAME_OVERHEAD + len);
  frame[0] = UBX_SYNC_1;
  frame[1] = UBX_SYNC_2;
  frame[2] = cls & 0xff;
  frame[3] = id & 0xff;
  frame[4] = len & 0xff;
  frame[5] = (len >> 8) & 0xff;
  frame.set(body, 6);
  const { a, b } = fletcher16(frame, 2, 4 + len);
  frame[6 + len] = a;
  frame[6 + len + 1] = b;
  return frame;
}

/**
 * Uppercase hex with spaces, for diagnostic display of a raw frame.
 * @param {Uint8Array} bytes
 */
export function bytesToHex(bytes) {
  if (!bytes) return '';
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (i ? ' ' : '') + bytes[i].toString(16).padStart(2, '0').toUpperCase();
  }
  return out;
}

/**
 * Streaming UBX frame parser. Accumulates raw BLE notification bytes and emits
 * complete, checksum-validated frames. Handles:
 *   - multiple frames in one notification,
 *   - a frame split across notifications,
 *   - garbage / resync (drops 1 byte and rescans on invalid sync/checksum),
 *   - oversized length fields.
 */
export class UbxFrameParser {
  constructor() {
    /** @type {number[]} */
    this._buf = [];
  }

  get pendingBytes() {
    return this._buf.length;
  }

  reset() {
    this._buf.length = 0;
  }

  /**
   * Push raw bytes and return every complete valid frame found so far.
   * @param {Uint8Array} chunk
   * @returns {RawFrame[]}
   */
  push(chunk) {
    for (let i = 0; i < chunk.length; i++) this._buf.push(chunk[i]);

    /** @type {RawFrame[]} */
    const frames = [];
    // Bound the buffer to avoid unbounded growth on a pathological stream.
    if (this._buf.length > 8192) this._buf.splice(0, this._buf.length - 8192);

    for (;;) {
      // Resync to sync bytes.
      let start = -1;
      for (let i = 0; i + 1 < this._buf.length; i++) {
        if (this._buf[i] === UBX_SYNC_1 && this._buf[i + 1] === UBX_SYNC_2) {
          start = i;
          break;
        }
      }
      if (start === -1) {
        // Keep only a trailing 0xB5 that might be the first sync byte.
        if (this._buf.length && this._buf[this._buf.length - 1] === UBX_SYNC_1) {
          this._buf = [this._buf[this._buf.length - 1]];
        } else {
          this._buf.length = 0;
        }
        break;
      }
      if (start > 0) this._buf.splice(0, start);

      if (this._buf.length < 6) break; // need class,id,length

      const payloadLen = this._buf[4] | (this._buf[5] << 8);
      if (payloadLen > UBX_MAX_PAYLOAD) {
        // Invalid length: drop the sync byte and rescan.
        this._buf.shift();
        continue;
      }

      const frameLen = UBX_FRAME_OVERHEAD + payloadLen;
      if (this._buf.length < frameLen) break; // wait for more bytes

      const frame = Uint8Array.from(this._buf.slice(0, frameLen));
      const { a, b } = fletcher16(frame, 2, 4 + payloadLen);
      const ok = frame[6 + payloadLen] === a && frame[6 + payloadLen + 1] === b;
      if (!ok) {
        // Bad checksum: drop the sync byte and try to resync after this frame.
        this._buf.shift();
        continue;
      }

      frames.push({
        cls: frame[2],
        id: frame[3],
        length: payloadLen,
        payload: frame.slice(6, 6 + payloadLen),
        frame,
      });
      this._buf.splice(0, frameLen);
    }

    return frames;
  }
}
