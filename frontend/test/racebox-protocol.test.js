import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fletcher16,
  encodeFrame,
  UbxFrameParser,
  UBX_CLASS_RACEBOX,
  RACEBOX_ID,
} from '../src/services/devices/racebox/RaceBoxProtocol.js';
import {
  decodePayload,
  decodeFrame,
  RaceBoxStreamDecoder,
} from '../src/services/devices/racebox/RaceBoxDecoder.js';
import {
  isPositionValid,
  hasValidTime,
} from '../src/services/devices/racebox/RaceBoxTypes.js';

// Test vectors are SYNTHETIC and constructed from the documented offsets. They
// are NOT captures from a real device; they validate the implementation against
// the documented layout, not the device itself.
function buildPayload(overrides = {}) {
  const buf = new ArrayBuffer(80);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const o = {
    iTOW: 123456789,
    year: 2026,
    month: 10,
    day: 18,
    hour: 12,
    minute: 34,
    second: 56,
    validityFlags: 0x07,
    fixStatus: 3,
    numSVs: 14,
    longitude: 3.7037902,
    latitude: 40.4167754,
    altitude: 650.25,
    wgsAltitude: 700.5,
    speed: 87.3,
    heading: 123.45,
    speedAccuracy: 0.5,
    headingAccuracy: 2.5,
    pdop: 1.2,
    gForceX: 123,
    gForceY: -456,
    gForceZ: 1000,
    rotRateX: 12.34,
    rotRateY: -5.67,
    rotRateZ: 0.01,
    batteryLevel: 77,
    charging: true,
    ...overrides,
  };

  v.setUint32(0, o.iTOW, true);
  v.setUint16(4, o.year, true);
  u8[6] = o.month;
  u8[7] = o.day;
  u8[8] = o.hour;
  u8[9] = o.minute;
  u8[10] = o.second;
  u8[11] = o.validityFlags;
  u8[20] = o.fixStatus;
  u8[23] = o.numSVs;
  v.setInt32(24, Math.round(o.longitude * 1e7), true);
  v.setInt32(28, Math.round(o.latitude * 1e7), true);
  v.setInt32(32, Math.round(o.wgsAltitude * 1000), true);
  v.setInt32(36, Math.round(o.altitude * 1000), true);
  v.setUint32(48, Math.round((o.speed / 3.6) * 1000), true);
  v.setUint32(52, Math.round(o.heading * 1e5), true);
  v.setUint32(56, Math.round((o.speedAccuracy / 3.6) * 1000), true);
  v.setUint32(60, Math.round(o.headingAccuracy * 1e5), true);
  v.setUint16(64, Math.round(o.pdop * 100), true);
  u8[66] = 0;
  u8[67] = (o.batteryLevel & 0x7f) | (o.charging ? 0x80 : 0);
  v.setInt16(68, Math.round(o.gForceX), true);
  v.setInt16(70, Math.round(o.gForceY), true);
  v.setInt16(72, Math.round(o.gForceZ), true);
  v.setInt16(74, Math.round(o.rotRateX * 100), true);
  v.setInt16(76, Math.round(o.rotRateY * 100), true);
  v.setInt16(78, Math.round(o.rotRateZ * 100), true);
  return u8;
}

function liveFrame(overrides) {
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.LIVE, buildPayload(overrides));
}

test('fletcher16 is a running mod-256 checksum', () => {
  const data = Uint8Array.from([0xff, 0x01, 0x05, 0x00, 1, 2, 3]);
  // a = sum(bytes), b = running sum of a
  let a = 0;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) & 0xff;
    b = (b + a) & 0xff;
  }
  assert.deepEqual(fletcher16(data, 0, data.length), { a, b });
});

test('encodeFrame produces a valid sync/length/checksum frame', () => {
  const frame = liveFrame();
  assert.equal(frame.length, 88);
  assert.equal(frame[0], 0xb5);
  assert.equal(frame[1], 0x62);
  assert.equal(frame[2], 0xff);
  assert.equal(frame[3], 0x01);
  assert.equal(frame[4], 80);
  assert.equal(frame[5], 0);
  const { a, b } = fletcher16(frame, 2, 84);
  assert.equal(frame[86], a);
  assert.equal(frame[87], b);
});

test('decodePayload maps documented offsets, signs and scales', () => {
  const record = decodePayload(buildPayload(), 1000);
  assert.ok(record);
  assert.equal(record.iTOW, 123456789);
  assert.equal(record.year, 2026);
  assert.equal(record.month, 10);
  assert.equal(record.day, 18);
  assert.equal(record.fixStatus, 3);
  assert.equal(record.numSVs, 14);
  assert.ok(Math.abs(record.latitude - 40.4167754) < 1e-6);
  assert.ok(Math.abs(record.longitude - 3.7037902) < 1e-6);
  assert.ok(Math.abs(record.altitude - 650.25) < 0.001);
  assert.ok(Math.abs(record.wgsAltitude - 700.5) < 0.001);
  assert.ok(Math.abs(record.speed - 87.3) < 0.05);
  assert.ok(Math.abs(record.heading - 123.45) < 1e-4);
  assert.ok(Math.abs(record.pdop - 120) < 1e-9);
  assert.equal(record.gForceX, 123);
  assert.equal(record.gForceY, -456);
  assert.equal(record.gForceZ, 1000);
  assert.ok(Math.abs(record.rotRateX - 1234) < 1e-9);
  assert.equal(record.batteryLevel, 77);
  assert.equal(record.charging, true);
  assert.equal(record.receivedAt, 1000);
});

test('decodePayload rejects short payloads and out-of-range coordinates', () => {
  assert.equal(decodePayload(new Uint8Array(10)), null);
  assert.equal(decodePayload(buildPayload({ latitude: 120 })), null);
  assert.equal(decodePayload(buildPayload({ longitude: -181 })), null);
});

test('decodeFrame maps live, ack, nack and unknown ids', () => {
  const parser = new UbxFrameParser();
  const [live] = parser.push(liveFrame());
  const msg = decodeFrame(live);
  assert.equal(msg.kind, 'live');
  assert.ok(msg.record);

  const ack = decodeFrame({ cls: 0xff, id: RACEBOX_ID.ACK, payload: new Uint8Array(0) });
  assert.equal(ack.kind, 'ack');
  const nack = decodeFrame({ cls: 0xff, id: RACEBOX_ID.NACK, payload: new Uint8Array(0) });
  assert.equal(nack.kind, 'nack');
  const history = decodeFrame({
    cls: 0xff,
    id: RACEBOX_ID.HISTORY,
    payload: buildPayload(),
  });
  assert.equal(history.kind, 'history');
  const unknown = decodeFrame({ cls: 0xff, id: 0x99, payload: new Uint8Array(0) });
  assert.equal(unknown.kind, 'unknown');
  assert.equal(decodeFrame({ cls: 0x01, id: 0x01, payload: new Uint8Array(0) }), null);
});

test('UbxFrameParser handles multiple frames in one notification', () => {
  const parser = new UbxFrameParser();
  const chunk = new Uint8Array([...liveFrame(), ...liveFrame({ iTOW: 2 })]);
  const frames = parser.push(chunk);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].length, 80);
  assert.equal(frames[0].payload[0], 0x15);
  assert.equal(parser.pendingBytes, 0);
});

test('UbxFrameParser handles a frame split across notifications', () => {
  const parser = new UbxFrameParser();
  const frame = liveFrame();
  const first = parser.push(frame.slice(0, 40));
  assert.equal(first.length, 0);
  const second = parser.push(frame.slice(40));
  assert.equal(second.length, 1);
  assert.equal(second[0].id, RACEBOX_ID.LIVE);
});

test('UbxFrameParser resyncs after garbage and rejects bad checksums', () => {
  const parser = new UbxFrameParser();
  const good = liveFrame();
  const bad = liveFrame();
  bad[bad.length - 1] ^= 0xff; // corrupt checksum

  const frames = parser.push(new Uint8Array([0x00, 0x11, ...bad, ...good]));
  assert.equal(frames.length, 1, 'only the good frame is emitted');
  assert.equal(frames[0].cls, 0xff);
});

test('UbxFrameParser drops an absurd length field and keeps scanning', () => {
  const parser = new UbxFrameParser();
  const garbage = Uint8Array.from([0xb5, 0x62, 0xff, 0x01, 0xff, 0xff]);
  const frames = parser.push(new Uint8Array([...garbage, ...liveFrame()]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].length, 80);
});

test('RaceBoxStreamDecoder counts frames and records without throwing', () => {
  const decoder = new RaceBoxStreamDecoder();
  const out = decoder.push(liveFrame());
  assert.equal(out.length, 1);
  assert.equal(decoder.framesReceived, 1);
  assert.equal(decoder.recordsDecoded, 1);
  assert.equal(decoder.decodeErrors, 0);

  const bad = liveFrame();
  bad[bad.length - 1] ^= 0xff;
  const out2 = decoder.push(bad);
  assert.equal(out2.length, 0);
  // The stream decoder still does not throw on garbage.
  assert.equal(decoder.recordsDecoded, 1);
});

// Official sample packet from RaceBox BLE Protocol Documentation rev 9 (page 8-9).
// Only the payload bytes the document explicitly lists are set; the middle bytes
// it does not show stay zero. This validates our field offsets/scaling against
// the vendor's own example (it is not a checksum test).
function officialSamplePayload() {
  const p = new Uint8Array(80);
  const set = (offset, bytes) => bytes.forEach((b, i) => (p[offset + i] = b));
  set(0, [0xa0, 0xe7, 0x0c, 0x07]); // iTOW 118286240
  set(4, [0xe6, 0x07]); // year 2022
  set(6, [0x01]); // month
  set(7, [0x0a]); // day
  set(8, [0x08]); // hour
  set(9, [0x33]); // minute
  set(10, [0x08]); // second
  set(11, [0x37]); // validity flags
  set(12, [0x19, 0x00, 0x00, 0x00]); // time accuracy 25 ns
  set(16, [0x2a, 0xad, 0x4d, 0x0e]); // nanoseconds
  set(20, [0x03]); // fix status 3D
  set(21, [0x01]); // fix status flags: valid fix
  set(22, [0xea]); // date/time flags
  set(23, [0x0b]); // number of SVs 11
  set(24, [0xc6, 0x93, 0xe1, 0x0d]); // longitude 23.2887238
  set(28, [0x3b, 0x37, 0x6f, 0x19]); // latitude 42.6719035
  set(32, [0x61, 0x8c, 0x09, 0x00]); // WGS altitude 625.761 m
  set(66, [0x00]); // lat/lon flags: coordinates valid
  set(67, [0x59]); // battery 89%, not charging
  set(68, [0xfd, 0xff]); // GForceX -3 mG
  set(70, [0x71, 0x00]); // GForceY 113 mG
  set(72, [0xce, 0x03]); // GForceZ 974 mG
  set(74, [0x2f, 0xff]); // rotation rate X -209
  set(76, [0x56, 0x00]); // rotation rate Y 86
  set(78, [0xfc, 0xff]); // rotation rate Z -4
  return p;
}

test('decodes the official RaceBox rev 9 sample packet exactly', () => {
  const r = decodePayload(officialSamplePayload(), 1234);
  assert.ok(r);
  assert.equal(r.iTOW, 118286240);
  assert.equal(r.year, 2022);
  assert.equal(r.month, 1);
  assert.equal(r.day, 10);
  assert.equal(r.hour, 8);
  assert.equal(r.minute, 51);
  assert.equal(r.second, 8);
  assert.equal(r.validityFlags, 0x37);
  assert.equal(r.fixStatus, 3);
  assert.equal(r.fixFlags, 0x01);
  assert.equal(r.numSVs, 11);
  assert.ok(Math.abs(r.latitude - 42.6719035) < 1e-6, `lat=${r.latitude}`);
  assert.ok(Math.abs(r.longitude - 23.2887238) < 1e-6, `lon=${r.longitude}`);
  assert.ok(Math.abs(r.wgsAltitude - 625.761) < 0.001, `wgsAlt=${r.wgsAltitude}`);
  assert.equal(r.latLonFlags, 0x00);
  assert.equal(r.batteryLevel, 89);
  assert.equal(r.charging, false);
  assert.equal(r.gForceX, -3);
  assert.equal(r.gForceY, 113);
  assert.equal(r.gForceZ, 974);
  assert.equal(r.rotRateX, -209);
  assert.equal(r.rotRateY, 86);
  assert.equal(r.rotRateZ, -4);
  assert.equal(isPositionValid(r), true);
  assert.equal(hasValidTime(r), true);
});

test('a frame with no GNSS fix is not a valid position', () => {
  // Real-world "no fix" record: fixStatus 0, no valid-fix flag, zero coordinates
  // and the Lat/Lon Flags bit0 set (coordinates invalid).
  const p = buildPayload({ fixStatus: 0, latitude: 0, longitude: 0, speed: 0, heading: 0 });
  p[21] = 0x00; // fix status flags: no valid fix
  p[66] = 0x01; // lat/lon flags: coordinates invalid
  p[11] = 0x00; // validity flags: date/time not valid
  const r = decodePayload(p);
  assert.ok(r);
  assert.equal(isPositionValid(r), false);
  assert.equal(hasValidTime(r), false);
  assert.equal(r.latitude, 0);
  assert.equal(r.longitude, 0);
});
