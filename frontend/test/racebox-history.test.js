import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStatusQuery,
  buildUnlock,
  buildDownloadStart,
  buildDownloadCancel,
  buildEraseStart,
  buildEraseCancel,
  buildRecordingCommand,
  parseMemoryStatus,
  parseExpectedCount,
  parseStateChange,
  parseAckTarget,
  DEFAULT_SECURITY_CODE,
} from '../src/services/devices/racebox/RaceBoxCommands.js';
import {
  UbxFrameParser,
  UBX_CLASS_RACEBOX,
  RACEBOX_ID,
} from '../src/services/devices/racebox/RaceBoxProtocol.js';
import { decodeFrame } from '../src/services/devices/racebox/RaceBoxDecoder.js';

function parseOne(frame) {
  const frames = new UbxFrameParser().push(frame);
  assert.equal(frames.length, 1, 'frame must have a valid checksum');
  return frames[0];
}

test('buildStatusQuery encodes 0xFF/0x22 with an empty payload', () => {
  const f = parseOne(buildStatusQuery());
  assert.equal(f.cls, UBX_CLASS_RACEBOX);
  assert.equal(f.id, RACEBOX_ID.REC_STATUS);
  assert.equal(f.length, 0);
});

test('buildUnlock encodes the 4-byte LE security code', () => {
  const f = parseOne(buildUnlock(DEFAULT_SECURITY_CODE));
  assert.equal(f.id, RACEBOX_ID.MEM_UNLOCK);
  assert.deepEqual([...f.payload], [0x40, 0xe2, 0x01, 0x00]); // 123456
});

test('buildDownloadStart / Cancel use 0xFF/0x23 with 0 and 1 byte', () => {
  const start = parseOne(buildDownloadStart());
  assert.equal(start.id, RACEBOX_ID.DOWNLOAD);
  assert.equal(start.length, 0);

  const cancel = parseOne(buildDownloadCancel());
  assert.equal(cancel.id, RACEBOX_ID.DOWNLOAD);
  assert.equal(cancel.length, 1);
});

test('buildEraseStart / Cancel use 0xFF/0x24', () => {
  assert.equal(parseOne(buildEraseStart()).length, 0);
  assert.equal(parseOne(buildEraseCancel()).length, 1);
});

test('buildRecordingCommand encodes the 12-byte config', () => {
  const f = parseOne(
    buildRecordingCommand({
      enable: true,
      rateHz: 25,
      stationaryFilter: true,
      noFixFilter: true,
      autoShutdownMin: 5,
    }),
  );
  assert.equal(f.id, RACEBOX_ID.REC_CONFIG);
  assert.equal(f.length, 12);
  assert.equal(f.payload[0], 1);
  assert.equal(f.payload[1], 25);
  assert.equal(f.payload[2], 0x0e); // stationary | no-fix | auto-shutdown
  assert.equal(f.payload[4] | (f.payload[5] << 8), 1389);
  assert.equal(f.payload[6] | (f.payload[7] << 8), 30);
  assert.equal(f.payload[8] | (f.payload[9] << 8), 30);
  assert.equal(f.payload[10] | (f.payload[11] << 8), 300);
});

test('buildRecordingCommand with only enable keeps a clean stop command', () => {
  const f = parseOne(buildRecordingCommand({ enable: false }));
  assert.equal(f.payload[0], 0);
  assert.equal(f.payload[2], 0);
});

test('parseMemoryStatus reads the 12-byte status', () => {
  const payload = Uint8Array.from([1, 42, 0x03, 0, 0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x03, 0x00]);
  const s = parseMemoryStatus(payload);
  assert.equal(s.recording, true);
  assert.equal(s.memoryPercent, 42);
  assert.equal(s.securityEnabled, true);
  assert.equal(s.unlocked, true);
  assert.equal(s.recordCount, 123456);
  assert.equal(s.memorySize, 196608);
});

test('parseMemoryStatus tolerates short and null payloads', () => {
  assert.equal(parseMemoryStatus(new Uint8Array(0)), null);
  assert.equal(parseMemoryStatus(null), null);
  const s = parseMemoryStatus(Uint8Array.from([0, 0, 0, 0]));
  assert.equal(s.recording, false);
  assert.equal(s.recordCount, null);
});

test('parseExpectedCount reads the UInt32 LE record count', () => {
  assert.equal(parseExpectedCount(Uint8Array.from([0x10, 0x27, 0x00, 0x00])), 10000);
  assert.equal(parseExpectedCount(new Uint8Array(2)), null);
});

test('parseStateChange reads the recording boundary', () => {
  const ev = parseStateChange(Uint8Array.from([1, 0, 25, 0x02]));
  assert.equal(ev.state, 1);
  assert.equal(ev.rateHz, 25);
  assert.equal(ev.flags, 0x02);
  assert.equal(parseStateChange(new Uint8Array(0)), null);
});

test('parseAckTarget reads the acknowledged class/id', () => {
  assert.deepEqual(parseAckTarget(Uint8Array.from([0xff, 0x23])), { cls: 0xff, id: 0x23 });
  assert.equal(parseAckTarget(Uint8Array.from([0xff])), null);
});

test('decodeFrame exposes payloads and the new command kinds', () => {
  const status = decodeFrame({ cls: 0xff, id: RACEBOX_ID.REC_STATUS, payload: Uint8Array.from([1, 2, 3]) });
  assert.equal(status.kind, 'status');
  assert.deepEqual([...status.payload], [1, 2, 3]);

  const download = decodeFrame({ cls: 0xff, id: RACEBOX_ID.DOWNLOAD, payload: Uint8Array.from([1, 0, 0, 0]) });
  assert.equal(download.kind, 'download');

  const state = decodeFrame({ cls: 0xff, id: RACEBOX_ID.STATE_CHANGE, payload: Uint8Array.from([1]) });
  assert.equal(state.kind, 'stateChange');

  const ack = decodeFrame({ cls: 0xff, id: RACEBOX_ID.ACK, payload: Uint8Array.from([0xff, 0x30]) });
  assert.equal(ack.kind, 'ack');

  const nack = decodeFrame({ cls: 0xff, id: RACEBOX_ID.NACK, payload: Uint8Array.from([0xff, 0x23]) });
  assert.equal(nack.kind, 'nack');

  const erase = decodeFrame({ cls: 0xff, id: RACEBOX_ID.ERASE, payload: Uint8Array.from([50]) });
  assert.equal(erase.kind, 'erase');
  assert.deepEqual([...erase.payload], [50]);
});
