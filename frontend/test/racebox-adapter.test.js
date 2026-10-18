import test from 'node:test';
import assert from 'node:assert/strict';

import { canTransition, BleConnectionState, BleError, BleErrorCode } from '../src/services/bluetooth/BleConnectionState.js';
import { BluetoothTransport, UnavailableBleTransport } from '../src/services/bluetooth/BluetoothTransport.js';
import { RaceBoxAdapter } from '../src/services/devices/racebox/RaceBoxAdapter.js';
import { encodeFrame, UBX_CLASS_RACEBOX, RACEBOX_ID, RACEBOX_SERVICE_UUID, RACEBOX_TX_UUID } from '../src/services/devices/racebox/RaceBoxProtocol.js';
function payload() {
  const buf = new ArrayBuffer(80);
  const v = new DataView(buf);
  v.setUint32(0, 42, true);
  v.setUint16(4, 2026, true);
  v.setUint8(6, 10);
  v.setUint8(7, 18);
  v.setUint8(8, 12);
  v.setUint8(20, 3);
  v.setUint8(23, 10);
  v.setInt32(24, Math.round(3.7037902 * 1e7), true);
  v.setInt32(28, Math.round(40.4167754 * 1e7), true);
  v.setUint32(48, Math.round((90 / 3.6) * 1000), true);
  v.setUint32(52, Math.round(180 * 1e5), true);
  v.setUint8(67, 80);
  return new Uint8Array(buf);
}

function liveFrame() {
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.LIVE, payload());
}

const SERVICES = [
  {
    uuid: RACEBOX_SERVICE_UUID,
    isPrimary: true,
    characteristics: [
      {
        uuid: RACEBOX_TX_UUID,
        read: false,
        write: false,
        writeWithoutResponse: false,
        notify: true,
        indicate: false,
      },
    ],
  },
];

class MockTransport extends BluetoothTransport {
  constructor(opts = {}) {
    super();
    this.opts = {
      available: true,
      kind: 'web',
      supportsDeviceList: false,
      supportsRssi: false,
      supportsContinuousScan: false,
      ...opts,
    };
    this.initCalls = 0;
    this.scanCalls = 0;
    this.stopScanCalls = 0;
    this.connectCalls = 0;
    this.subCalls = 0;
    this.unsubCalls = 0;
    this.disconnectCalls = 0;
    this.destroyCalls = 0;
    this.services = SERVICES;
    this.onDevice = null;
    this.onDisconnect = null;
    this.notifyCb = null;
    this._available = this.opts.available;
  }

  get capabilities() {
    return {
      available: this._available,
      kind: this.opts.kind,
      secureContext: true,
      supportsDeviceList: this.opts.supportsDeviceList,
      supportsRssi: this.opts.supportsRssi,
      supportsContinuousScan: this.opts.supportsContinuousScan,
      unavailableReason: this._available ? null : 'mock unavailable',
    };
  }

  async initialize() {
    this.initCalls += 1;
    if (!this._available) {
      throw new BleError(BleErrorCode.UNSUPPORTED, 'mock unavailable');
    }
  }

  async startScan(_options, onDevice) {
    this.scanCalls += 1;
    this.onDevice = onDevice;
    if (this.opts.continuous) return; // continuous: caller keeps scanning
    onDevice({ id: 'dev-1', name: 'RaceBox Mini 1234567890', rssi: null, platform: 'web' });
  }

  async stopScan() {
    this.stopScanCalls += 1;
  }

  async connect(deviceId, onDisconnect) {
    this.connectCalls += 1;
    this.onDisconnect = onDisconnect;
    this.connectedId = deviceId;
  }

  async discoverServices() {
    return this.services;
  }

  async startNotifications(deviceId, service, characteristic, cb) {
    this.subCalls += 1;
    this.notifyCb = cb;
  }

  async stopNotifications() {
    this.unsubCalls += 1;
  }

  async write(deviceId, service, characteristic, data) {
    this.writeCalls = (this.writeCalls || 0) + 1;
    this.lastWrite = data;
    if (this.onWrite) this.onWrite(data);
  }

  emitFrame(cls, id, payloadBytes) {
    const frame = encodeFrame(cls, id, payloadBytes || []);
    if (this.notifyCb) this.notifyCb(frame);
  }

  async disconnect() {
    this.disconnectCalls += 1;
  }

  async destroy() {
    this.destroyCalls += 1;
  }
}

function makeAdapter(transport) {
  return new RaceBoxAdapter({ transportFactory: async () => transport });
}

test('state machine only allows controlled transitions', () => {
  assert.equal(canTransition(BleConnectionState.IDLE, BleConnectionState.SCANNING), true);
  assert.equal(canTransition(BleConnectionState.SCANNING, BleConnectionState.CONNECTING), true);
  assert.equal(canTransition(BleConnectionState.CONNECTING, BleConnectionState.CONNECTED), true);
  assert.equal(canTransition(BleConnectionState.CONNECTED, BleConnectionState.RECEIVING), true);
  assert.equal(canTransition(BleConnectionState.RECEIVING, BleConnectionState.CONNECTED), true);
  assert.equal(canTransition(BleConnectionState.IDLE, BleConnectionState.RECEIVING), false);
});

test('initialize transitions idle -> initializing -> idle', async () => {
  const transport = new MockTransport();
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  assert.equal(transport.initCalls, 1);
  assert.equal(adapter.getSnapshot().state, BleConnectionState.IDLE);
});

test('scan discovers the selected device and a web picker ends the scan', async () => {
  const transport = new MockTransport();
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  const snap = adapter.getSnapshot();
  assert.equal(snap.devices.length, 1);
  assert.equal(snap.devices[0].name, 'RaceBox Mini 1234567890');
  assert.equal(snap.state, BleConnectionState.IDLE);
});

test('connect -> receive -> disconnect works end to end', async () => {
  const transport = new MockTransport();
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');

  let snap = adapter.getSnapshot();
  assert.equal(snap.state, BleConnectionState.CONNECTED);
  assert.equal(snap.services.length, 1);

  await adapter.startReceiving();
  snap = adapter.getSnapshot();
  assert.equal(snap.state, BleConnectionState.RECEIVING);
  assert.equal(transport.subCalls, 1);

  transport.notifyCb(liveFrame());
  snap = adapter.getSnapshot();
  assert.equal(snap.packets, 1);
  assert.equal(snap.frames, 1);
  assert.equal(snap.decodeErrors, 0);
  assert.ok(snap.latest);
  assert.ok(Math.abs(snap.latest.latitude - 40.4167754) < 1e-6);
  assert.ok(Math.abs(snap.latest.speed - 90) < 0.05);

  await adapter.stopReceiving();
  assert.equal(adapter.getSnapshot().state, BleConnectionState.CONNECTED);
  assert.equal(transport.unsubCalls, 1);

  await adapter.disconnect();
  snap = adapter.getSnapshot();
  assert.equal(snap.state, BleConnectionState.DISCONNECTED);
  assert.equal(snap.connectedDeviceId, null);
  assert.equal(transport.disconnectCalls, 1);
});

test('an unexpected disconnect is surfaced without throwing', async () => {
  const transport = new MockTransport();
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');
  await adapter.startReceiving();

  transport.onDisconnect('dev-1');
  const snap = adapter.getSnapshot();
  assert.equal(snap.state, BleConnectionState.DISCONNECTED);
  assert.equal(snap.errorCode, 'disconnected');
  assert.equal(snap.receiving, false);
});

test('manual disconnect does not report an unexpected-disconnect error', async () => {
  const transport = new MockTransport();
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');

  await adapter.disconnect();
  transport.onDisconnect('dev-1');
  const snap = adapter.getSnapshot();
  assert.equal(snap.errorCode, null);
  assert.equal(snap.state, BleConnectionState.DISCONNECTED);
});

test('unsupported platform stays idle with a visible reason', async () => {
  const transport = new MockTransport({ available: false });
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  const snap = adapter.getSnapshot();
  assert.equal(snap.state, BleConnectionState.IDLE);
  assert.equal(snap.errorCode, 'unsupported');
  assert.ok(snap.errorMessage);
});

test('cancelling the web picker returns to idle with a warning', async () => {
  class CancelTransport extends MockTransport {
    async startScan() {
      const err = new Error('User cancelled');
      err.name = 'NotFoundError';
      throw err;
    }
  }
  const transport = new CancelTransport();
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  const snap = adapter.getSnapshot();
  assert.equal(snap.state, BleConnectionState.IDLE);
  assert.match(snap.warning || '', /cancelada/i);
});

test('missing NUS TX characteristic fails the connection', async () => {
  const transport = new MockTransport();
  transport.services = [
    { uuid: '0000180d-0000-1000-8000-00805f9b34fb', isPrimary: true, characteristics: [] },
  ];
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');
  const snap = adapter.getSnapshot();
  assert.equal(snap.state, BleConnectionState.DISCONNECTED);
  assert.equal(snap.errorCode, 'service_not_found');
  assert.equal(transport.disconnectCalls, 1);
});

test('destroy releases the transport and returns to idle', async () => {
  const transport = new MockTransport();
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');
  await adapter.destroy();
  assert.equal(transport.destroyCalls, 1);
  assert.equal(adapter.getSnapshot().state, BleConnectionState.IDLE);
});

test('UnavailableBleTransport reports a clear reason instead of crashing', async () => {
  const transport = new UnavailableBleTransport('no bluetooth here');
  assert.equal(transport.capabilities.available, false);
  await assert.rejects(() => transport.initialize(), /no bluetooth here/);
});

test('re-initialization after destroy works (React StrictMode remount)', async () => {
  let created = 0;
  const adapter = new RaceBoxAdapter({
    transportFactory: async () => {
      created += 1;
      return new MockTransport();
    },
  });

  const firstInit = adapter.initialize(); // starts, then gets torn down
  await adapter.destroy();
  await firstInit;

  await adapter.initialize();
  await adapter.startScan();
  const snap = adapter.getSnapshot();
  assert.equal(snap.state, BleConnectionState.IDLE);
  assert.equal(snap.devices.length, 1);
  assert.ok(created >= 2, 'a fresh transport is created after destroy');
});

const STATUS_PAYLOAD = Uint8Array.from([1, 42, 0x03, 0, 0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x03, 0x00]);

function historyFrame(record) {
  return encodeFrame(UBX_CLASS_RACEBOX, RACEBOX_ID.HISTORY, record);
}

async function connectedAdapter(onWrite) {
  const transport = new MockTransport();
  transport.onWrite = onWrite;
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');
  await adapter.startReceiving();
  return { adapter, transport };
}

test('queryMemoryStatus parses the 0xFF/0x22 response', async () => {
  const transport = new MockTransport();
  transport.onWrite = (bytes) => {
    if (bytes[3] === RACEBOX_ID.REC_STATUS) {
      transport.emitFrame(0xff, 0x22, STATUS_PAYLOAD);
    }
  };
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');
  await adapter.startReceiving();

  const status = await adapter.queryMemoryStatus();
  assert.equal(status.recording, true);
  assert.equal(status.memoryPercent, 42);
  assert.equal(status.recordCount, 123456);
  assert.equal(status.memorySize, 196608);
  assert.deepEqual(adapter.getSnapshot().memory, status);
});

test('startHistoryDownload unlocks, downloads and splits sessions', async () => {
  const records = [
    Uint8Array.from(payload()),
    Uint8Array.from(payload()),
    Uint8Array.from(payload()),
    Uint8Array.from(payload()),
    Uint8Array.from(payload()),
  ];

  const transport = new MockTransport();
  let downloaded = false;
  transport.onWrite = (bytes) => {
    const id = bytes[3];
    if (id === RACEBOX_ID.MEM_UNLOCK) {
      transport.emitFrame(0xff, 0x02, [0xff, RACEBOX_ID.MEM_UNLOCK]); // unlock ACK
    } else if (id === RACEBOX_ID.DOWNLOAD && bytes.length === 8) {
      transport.emitFrame(0xff, 0x23, [0x05, 0x00, 0x00, 0x00]); // expected = 5
      if (!downloaded) {
        downloaded = true;
        transport.emitFrame(0xff, 0x26, [1]); // session 1 start
        transport.emitFrame(0xff, 0x21, records[0]);
        transport.emitFrame(0xff, 0x21, records[1]);
        transport.emitFrame(0xff, 0x26, [0]); // session 1 stop
        transport.emitFrame(0xff, 0x26, [1]); // session 2 start
        transport.emitFrame(0xff, 0x21, records[2]);
        transport.emitFrame(0xff, 0x21, records[3]);
        transport.emitFrame(0xff, 0x26, [0]); // session 2 stop
        transport.emitFrame(0xff, 0x02, [0xff, RACEBOX_ID.DOWNLOAD]); // download complete
      }
    }
  };

  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');
  await adapter.startReceiving();

  const result = await adapter.startHistoryDownload({ securityCode: 123456 });
  assert.equal(result.expected, 5);
  assert.equal(result.received, 4);
  assert.equal(result.sessions.length, 2, `sessions=${result.sessions.length}`);
  assert.equal(result.sessions[0].records.length, 2);
  assert.equal(result.sessions[1].records.length, 2);
  assert.equal(adapter.getSnapshot().history.phase, 'done');
  assert.equal(adapter.getSnapshot().history.received, 4);
});

test('startHistoryDownload fails cleanly when the unlock is NACKed', async () => {
  const transport = new MockTransport();
  transport.onWrite = (bytes) => {
    if (bytes[3] === RACEBOX_ID.MEM_UNLOCK) {
      transport.emitFrame(0xff, 0x03, [0xff, RACEBOX_ID.MEM_UNLOCK]); // NACK
    }
  };
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');
  await adapter.startReceiving();

  await assert.rejects(
    () => adapter.startHistoryDownload({ securityCode: 999999 }),
    /código de seguridad/i,
  );
  assert.equal(adapter.getSnapshot().history.phase, 'error');
});

test('eraseDeviceMemory resolves on the erase ACK', async () => {
  const transport = new MockTransport();
  transport.onWrite = (bytes) => {
    if (bytes[3] === RACEBOX_ID.ERASE && bytes.length === 8) {
      transport.emitFrame(0xff, 0x24, [50]); // progress
      transport.emitFrame(0xff, 0x24, [100]);
      transport.emitFrame(0xff, 0x02, [0xff, RACEBOX_ID.ERASE]);
    }
  };
  const adapter = makeAdapter(transport);
  await adapter.initialize();
  await adapter.startScan();
  await adapter.connect('dev-1');
  await adapter.startReceiving();

  assert.equal(await adapter.eraseDeviceMemory(), true);
});
