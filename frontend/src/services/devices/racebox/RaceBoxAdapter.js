// RaceBoxAdapter — RaceBox lifecycle and protocol handling on top of a generic
// BluetoothTransport.
//
// Responsibilities:
//   - own the connection state machine,
//   - scan/connect/disconnect,
//   - discover GATT and locate the Nordic UART TX characteristic,
//   - subscribe/unsubscribe and feed bytes to the stream decoder,
//   - expose typed snapshots to React (never raw GATT packets).
//
// It does NOT talk to the React tree and does NOT know about Capacitor/Web
// Bluetooth specifics.

import {
  createBluetoothTransport,
  isNativePlatform,
} from '../../bluetooth/index.js';
import {
  BleConnectionState,
  BleError,
  BleErrorCode,
  STATE_LABELS,
  canTransition,
  normalizeBleError,
} from '../../bluetooth/BleConnectionState.js';
import { findCharacteristic } from '../../bluetooth/BluetoothTransport.js';
import {
  RACEBOX_SERVICE_UUID,
  RACEBOX_TX_UUID,
  RACEBOX_RX_UUID,
  UBX_CLASS_RACEBOX,
  RACEBOX_ID,
  bytesToHex,
} from './RaceBoxProtocol.js';
import { RaceBoxStreamDecoder } from './RaceBoxDecoder.js';
import {
  buildStatusQuery,
  buildUnlock,
  buildDownloadStart,
  buildDownloadCancel,
  buildEraseStart,
  parseMemoryStatus,
  parseExpectedCount,
  parseStateChange,
  parseAckTarget,
  DEFAULT_SECURITY_CODE,
} from './RaceBoxCommands.js';

const MAX_DEVICES = 50;
const MAX_RECENT_RECORDS = 120;
const RATE_WINDOW_MS = 2000;
const COMMAND_TIMEOUT_MS = 10000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

function isAckTarget(msg, commandId) {
  if (!msg || !msg.payload) return false;
  const target = parseAckTarget(msg.payload);
  return !!target && target.cls === UBX_CLASS_RACEBOX && target.id === commandId;
}

/**
 * @typedef {Object} RaceBoxSnapshot
 * @property {string} state
 * @property {string} stateLabel
 * @property {boolean} initialized
 * @property {import('../bluetooth/BluetoothTransport.js').TransportCapabilities|null} capabilities
 * @property {import('../bluetooth/BleDevice.js').BleDevice[]} devices
 * @property {string|null} connectedDeviceId
 * @property {string|null} connectedDeviceName
 * @property {import('../bluetooth/BleDevice.js').BleService[]} services
 * @property {boolean} receiving
 * @property {string|null} errorCode
 * @property {string|null} errorMessage
 * @property {string|null} warning
 * @property {number} packets
 * @property {number} frames
 * @property {number} decodeErrors
 * @property {number|null} lastPacketAt
 * @property {number} packetsPerSecond
 * @property {import('./RaceBoxTypes.js').RaceBoxRecord|null} latest
 * @property {import('./RaceBoxTypes.js').RaceBoxRecord[]} recent
 * @property {number} pendingBytes
 */

export class RaceBoxAdapter {
  /**
   * @param {{ transportFactory?: () => Promise<any> }} [options] Injection point for tests.
   */
  constructor(options = {}) {
    this._transportFactory =
      options.transportFactory || (() => createBluetoothTransport());
    /** @type {any} */
    this._transport = null;
    this._initialized = false;

    this._state = BleConnectionState.IDLE;
    /** @type {import('../bluetooth/BleDevice.js').BleDevice[]} */
    this._devices = [];
    this._connectedDeviceId = null;
    this._connectedDeviceName = null;
    /** @type {import('../bluetooth/BleDevice.js').BleService[]} */
    this._services = [];
    this._receiving = false;

    this._errorCode = null;
    this._errorMessage = null;
    this._warning = null;

    this._decoder = new RaceBoxStreamDecoder();
    this._packets = 0;
    this._frames = 0;
    this._decodeErrors = 0;
    this._lastPacketAt = null;
    this._recordTimes = [];
    /** @type {import('./RaceBoxTypes.js').RaceBoxRecord|null} */
    this._latest = null;
    /** @type {import('./RaceBoxTypes.js').RaceBoxRecord[]} */
    this._recent = [];

    this._manualDisconnect = false;
    this._destroyed = false;
    this._generation = 0;
    this._listeners = new Set();

    // Memory / history download state.
    /** @type {ReturnType<typeof parseMemoryStatus>|null} */
    this._memory = null;
    this._history = { phase: 'idle', expected: 0, received: 0, error: null };
    /** @type {import('./RaceBoxTypes.js').RaceBoxRecord[]} */
    this._historyRecords = [];
    /** @type {{index: number, event: number}[]} */
    this._historyEvents = [];
    /** @type {{test: (m:any)=>boolean, resolve:(m:any)=>void, reject:(e:any)=>void, timer:any}[]} */
    this._commandWaiters = [];

    this._snapshot = this._buildSnapshot();
  }

  // ── Subscription API (useSyncExternalStore-friendly) ───────────────────────

  /** @param {() => void} listener */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** @returns {RaceBoxSnapshot} */
  getSnapshot() {
    return this._snapshot;
  }

  get state() {
    return this._state;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async initialize() {
    if (this._initialized) return;
    // Allow re-initialization after destroy() (React StrictMode remounts).
    this._destroyed = false;
    const generation = this._generation;
    this._setState(BleConnectionState.INITIALIZING);
    this._clearError();
    try {
      const transport = await this._transportFactory();
      if (generation !== this._generation) {
        // Superseded by destroy()/re-init: release the orphan transport.
        try {
          await transport?.destroy?.();
        } catch (_) {
          /* ignore */
        }
        return;
      }
      this._transport = transport;
      try {
        await this._transport.initialize();
        if (generation !== this._generation) return;
        this._initialized = true;
        this._setState(BleConnectionState.IDLE);
      } catch (err) {
        if (generation !== this._generation) return;
        const bleErr = normalizeBleError(err, BleErrorCode.NOT_INITIALIZED);
        if (bleErr.code === BleErrorCode.UNSUPPORTED || bleErr.code === BleErrorCode.INSECURE_CONTEXT) {
          // No BLE on this browser: stay idle, keep the reason visible, do not
          // make it a permanent blocking error state.
          this._initialized = true;
          this._errorCode = bleErr.code;
          this._errorMessage = bleErr.message;
          this._setState(BleConnectionState.IDLE);
        } else {
          this._fail(bleErr.code, bleErr.message);
        }
      }
    } catch (err) {
      if (generation !== this._generation) return;
      const bleErr = normalizeBleError(err, BleErrorCode.UNSUPPORTED);
      this._initialized = true;
      this._errorCode = bleErr.code;
      this._errorMessage = bleErr.message;
      this._setState(BleConnectionState.IDLE);
    }
    this._emit();
  }

  async startScan() {
    if (!this._initialized) await this.initialize();
    if (!this._canScan()) return;
    if (!this._transport || this._transport.capabilities.available === false) {
      this._errorCode = BleErrorCode.UNSUPPORTED;
      this._errorMessage =
        this._transport?.capabilities?.unavailableReason ||
        'Bluetooth no está disponible en esta plataforma.';
      this._emit();
      return;
    }

    this._devices = [];
    this._clearError();
    this._setState(BleConnectionState.SCANNING);
    this._emit();

    try {
      await this._transport.startScan({}, (device) => this._onDevice(device));
      // Web picker resolves once the user picked a device (scan over).
      // Native continuous scan keeps the SCANNING state until stopScan().
      if (!this._transport.capabilities.supportsContinuousScan) {
        this._stopScanState();
      }
    } catch (err) {
      const bleErr = normalizeBleError(err, BleErrorCode.SCAN_FAILED);
      if (bleErr.code === BleErrorCode.USER_CANCELLED) {
        this._warning = 'Selección de dispositivo cancelada.';
        this._setState(BleConnectionState.IDLE);
      } else {
        this._fail(bleErr.code, bleErr.message, BleConnectionState.IDLE);
      }
    }
    this._emit();
  }

  async stopScan() {
    if (this._state !== BleConnectionState.SCANNING) return;
    try {
      await this._transport?.stopScan();
    } catch (_) {
      /* ignore */
    }
    this._stopScanState();
    this._emit();
  }

  async connect(deviceId) {
    if (!this._transport) return;
    const device = this._devices.find((d) => d.id === deviceId);
    if (!device) {
      this._fail(
        BleErrorCode.CONNECT_FAILED,
        'El dispositivo seleccionado ya no está en la lista. Vuelve a escanear.',
      );
      return;
    }
    if (
      this._state !== BleConnectionState.SCANNING &&
      this._state !== BleConnectionState.IDLE &&
      this._state !== BleConnectionState.DISCONNECTED &&
      this._state !== BleConnectionState.ERROR
    ) {
      return;
    }

    if (this._state === BleConnectionState.SCANNING) {
      try {
        await this._transport.stopScan();
      } catch (_) {
        /* ignore */
      }
    }

    this._clearError();
    this._manualDisconnect = false;
    this._setState(BleConnectionState.CONNECTING);
    this._emit();

    try {
      await this._transport.connect(deviceId, (id) => this._onUnexpectedDisconnect(id));
      this._services = await this._transport.discoverServices(deviceId);
      // Validate the NUS TX characteristic exists before declaring success.
      findCharacteristic(this._services, RACEBOX_SERVICE_UUID, RACEBOX_TX_UUID);
      this._connectedDeviceId = deviceId;
      this._connectedDeviceName = device.name || null;
      this._setState(BleConnectionState.CONNECTED);
    } catch (err) {
      const bleErr = normalizeBleError(err, BleErrorCode.CONNECT_FAILED);
      this._connectedDeviceId = null;
      this._connectedDeviceName = null;
      this._services = [];
      try {
        await this._transport.disconnect(deviceId);
      } catch (_) {
        /* ignore */
      }
      this._fail(bleErr.code, bleErr.message, BleConnectionState.DISCONNECTED);
    }
    this._emit();
  }

  async startReceiving() {
    if (this._state !== BleConnectionState.CONNECTED || !this._connectedDeviceId) {
      return;
    }
    this._clearError();
    this._decoder.reset();
    this._resetMetrics();
    try {
      await this._transport.startNotifications(
        this._connectedDeviceId,
        RACEBOX_SERVICE_UUID,
        RACEBOX_TX_UUID,
        (bytes) => this._onData(bytes),
      );
      this._receiving = true;
      this._setState(BleConnectionState.RECEIVING);
    } catch (err) {
      const bleErr = normalizeBleError(err, BleErrorCode.SUBSCRIBE_FAILED);
      this._fail(bleErr.code, bleErr.message, BleConnectionState.CONNECTED);
    }
    this._emit();
  }

  async stopReceiving() {
    if (!this._receiving || !this._connectedDeviceId) return;
    try {
      await this._transport.stopNotifications(
        this._connectedDeviceId,
        RACEBOX_SERVICE_UUID,
        RACEBOX_TX_UUID,
      );
    } catch (_) {
      /* ignore */
    }
    this._receiving = false;
    this._setState(BleConnectionState.CONNECTED);
    this._emit();
  }

  // ── Memory / history download ─────────────────────────────────────────────

  /** Query 0xFF/0x22 memory status (recording flag, level, security, counts). */
  async queryMemoryStatus() {
    this._ensureConnected();
    await this._ensureReceiving();
    const waiter = this._waitForCommand((m) => m.kind === 'status', COMMAND_TIMEOUT_MS, 'estado de memoria');
    await this._writeRx(buildStatusQuery());
    const msg = await waiter;
    this._memory = parseMemoryStatus(msg.payload);
    this._emit();
    return this._memory;
  }

  /**
   * Download all stored sessions: unlock memory, trigger the download, collect
   * the streamed history records and split them into sessions.
   * Resolves with { sessions: [{ records }] , expected, received }.
   * The caller is responsible for persisting the sessions.
   */
  async startHistoryDownload({ securityCode = DEFAULT_SECURITY_CODE, unlock = true } = {}) {
    this._ensureConnected();
    await this._ensureReceiving();
    this._history = { phase: 'unlocking', expected: 0, received: 0, error: null };
    this._historyRecords = [];
    this._historyEvents = [];
    this._emit();

    try {
      if (unlock) {
        const unlockWaiter = this._waitForCommand(
          (m) => (m.kind === 'ack' || m.kind === 'nack') && isAckTarget(m, RACEBOX_ID.MEM_UNLOCK),
          COMMAND_TIMEOUT_MS,
          'desbloqueo de memoria',
        );
        await this._writeRx(buildUnlock(securityCode));
        const ack = await unlockWaiter;
        if (ack.kind === 'nack') {
          throw new BleError(
            BleErrorCode.PROTOCOL_ERROR,
            'La memoria rechazó el código de seguridad (¿es 123456?).',
          );
        }
      }

      this._history.phase = 'requested';
      this._emit();

      const countWaiter = this._waitForCommand(
        (m) => m.kind === 'download' && m.payload && m.payload.length >= 4,
        COMMAND_TIMEOUT_MS,
        'recuento de registros',
      );
      const doneWaiter = this._waitForCommand(
        (m) => (m.kind === 'ack' || m.kind === 'nack') && isAckTarget(m, RACEBOX_ID.DOWNLOAD),
        DOWNLOAD_TIMEOUT_MS,
        'fin de la descarga',
      );
      await this._writeRx(buildDownloadStart());

      const countMsg = await countWaiter;
      this._history.expected = parseExpectedCount(countMsg.payload) || 0;
      this._history.phase = 'receiving';
      this._emit();

      const done = await doneWaiter;
      if (done.kind === 'nack') {
        throw new BleError(
          BleErrorCode.PROTOCOL_ERROR,
          'El dispositivo rechazó la descarga (memoria bloqueada u otra operación en curso).',
        );
      }

      this._history.phase = 'done';
      const sessions = this._buildSessions();
      this._emit();
      return { sessions, expected: this._history.expected, received: this._history.received };
    } catch (err) {
      const bleErr = normalizeBleError(err, BleErrorCode.PROTOCOL_ERROR);
      this._history.phase = 'error';
      this._history.error = bleErr.message;
      this._emit();
      throw bleErr;
    }
  }

  /** Cancel an ongoing download (0xFF/0x23 with a 1-byte payload). */
  async cancelHistoryDownload() {
    if (!this._connectedDeviceId) return;
    try {
      await this._writeRx(buildDownloadCancel());
    } catch (_) {
      /* ignore */
    }
  }

  /** Erase stored memory (0xFF/0x24). Irreversible; guarded in the UI. */
  async eraseDeviceMemory() {
    this._ensureConnected();
    await this._ensureReceiving();
    const waiter = this._waitForCommand(
      (m) => (m.kind === 'ack' || m.kind === 'nack') && isAckTarget(m, RACEBOX_ID.ERASE),
      5 * 60 * 1000,
      'fin del borrado',
    );
    await this._writeRx(buildEraseStart());
    const done = await waiter;
    if (done.kind === 'nack') {
      throw new BleError(BleErrorCode.PROTOCOL_ERROR, 'El dispositivo rechazó el borrado.');
    }
    return true;
  }

  _ensureConnected() {
    if (!this._connectedDeviceId || !this._transport) {
      throw new BleError(BleErrorCode.DISCONNECTED, 'Conecta primero con la RaceBox.');
    }
  }

  async _ensureReceiving() {
    if (this._receiving) return;
    await this.startReceiving();
    if (!this._receiving) {
      throw new BleError(
        BleErrorCode.SUBSCRIBE_FAILED,
        'No se pudo activar la recepción de notificaciones.',
      );
    }
  }

  async _writeRx(bytes) {
    this._ensureConnected();
    await this._transport.write(
      this._connectedDeviceId,
      RACEBOX_SERVICE_UUID,
      RACEBOX_RX_UUID,
      bytes,
    );
  }

  _waitForCommand(test, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this._commandWaiters = this._commandWaiters.filter((w) => w !== waiter);
        reject(
          new BleError(BleErrorCode.PROTOCOL_ERROR, `Tiempo de espera agotado: ${label}.`),
        );
      }, timeoutMs);
      this._commandWaiters.push(waiter);
    });
  }

  _dispatchCommand(msg) {
    const index = this._commandWaiters.findIndex((w) => {
      try {
        return w.test(msg);
      } catch (_) {
        return false;
      }
    });
    if (index < 0) return;
    const [waiter] = this._commandWaiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(msg);
  }

  _clearCommandWaiters(reason) {
    const waiters = this._commandWaiters;
    this._commandWaiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      try {
        w.reject(reason);
      } catch (_) {
        /* ignore */
      }
    }
  }

  /** Split the downloaded records into sessions using 0xFF/0x26 boundaries. */
  _buildSessions() {
    const records = this._historyRecords;
    if (!records.length) return [];
    const events = this._historyEvents;
    if (!events.length) return [{ records }];

    const sessions = [];
    let current = [];
    let e = 0;
    const flush = () => {
      if (current.length) {
        sessions.push({ records: current });
        current = [];
      }
    };
    const applyEvent = (ev) => {
      // 1 = recording start, 0 = stop, 2 = pause -> all close the current session
      if (ev === 1 || ev === 0 || ev === 2) flush();
    };
    for (let i = 0; i < records.length; i++) {
      while (e < events.length && events[e].index <= i) {
        applyEvent(events[e].event);
        e++;
      }
      current.push(records[i]);
    }
    while (e < events.length) {
      applyEvent(events[e].event);
      e++;
    }
    flush();
    return sessions;
  }

  async disconnect() {
    this._manualDisconnect = true;
    const id = this._connectedDeviceId;
    if (this._receiving) await this.stopReceiving();
    if (id && this._transport) {
      try {
        await this._transport.disconnect(id);
      } catch (_) {
        /* ignore */
      }
    }
    this._connectedDeviceId = null;
    this._connectedDeviceName = null;
    this._services = [];
    this._receiving = false;
    this._setState(BleConnectionState.DISCONNECTED);
    this._emit();
  }

  async destroy() {
    const generation = (this._generation += 1);
    this._destroyed = true;
    this._manualDisconnect = true;
    this._clearCommandWaiters(new BleError(BleErrorCode.DISCONNECTED, 'Adaptador destruido.'));
    this._history.phase = 'idle';
    const transport = this._transport;
    this._transport = null;
    try {
      await transport?.destroy();
    } catch (_) {
      /* ignore */
    }
    // A new initialize() started while we were tearing down: leave it alone.
    if (generation !== this._generation) return;
    this._initialized = false;
    this._receiving = false;
    this._connectedDeviceId = null;
    this._connectedDeviceName = null;
    this._services = [];
    this._listeners.clear();
    this._state = BleConnectionState.IDLE;
    this._emit();
  }

  /** True when the current platform is the native Capacitor container. */
  get isNative() {
    return isNativePlatform();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  _canScan() {
    return (
      this._state === BleConnectionState.IDLE ||
      this._state === BleConnectionState.DISCONNECTED ||
      this._state === BleConnectionState.ERROR
    );
  }

  _onDevice(device) {
    if (!device || !device.id) return;
    const existing = this._devices.findIndex((d) => d.id === device.id);
    if (existing >= 0) {
      this._devices[existing] = device;
    } else {
      if (this._devices.length >= MAX_DEVICES) this._devices.shift();
      this._devices.push(device);
    }
    this._emit();
  }

  _onUnexpectedDisconnect(deviceId) {
    if (this._destroyed) return;
    if (this._manualDisconnect) return;
    if (deviceId && this._connectedDeviceId && deviceId !== this._connectedDeviceId) {
      return;
    }
    this._clearCommandWaiters(new BleError(BleErrorCode.DISCONNECTED, 'Dispositivo desconectado.'));
    this._history.phase = 'idle';
    this._receiving = false;
    this._connectedDeviceId = null;
    this._connectedDeviceName = null;
    this._services = [];
    this._errorCode = BleErrorCode.DISCONNECTED;
    this._errorMessage = 'El dispositivo se ha desconectado inesperadamente.';
    this._setState(BleConnectionState.DISCONNECTED);
    this._emit();
  }

  _onData(bytes) {
    if (this._destroyed) return;
    const messages = this._decoder.push(bytes);
    this._frames = this._decoder.framesReceived;
    this._decodeErrors = this._decoder.decodeErrors;

    const now = Date.now();
    for (const msg of messages) {
      if (msg.kind === 'live') {
        this._onLiveRecord(msg.record, now);
      } else if (msg.kind === 'history') {
        if (this._historyRecords.length === 0) this._history.startedAt = now;
        this._historyRecords.push(msg.record);
        this._history.received = this._historyRecords.length;
      } else if (msg.kind === 'stateChange') {
        const ev = parseStateChange(msg.payload);
        this._historyEvents.push({
          index: this._historyRecords.length,
          event: ev ? ev.state : 0,
        });
      } else {
        this._dispatchCommand(msg);
      }
    }
    // Sliding window for an approximate update rate.
    const cutoff = now - RATE_WINDOW_MS;
    while (this._recordTimes.length && this._recordTimes[0] < cutoff) {
      this._recordTimes.shift();
    }
    this._emit();
  }

  _onLiveRecord(record, now) {
    if (!record) return;
    this._packets += 1;
    this._lastPacketAt = now;
    this._latest = record;
    this._recent.push(record);
    if (this._recent.length > MAX_RECENT_RECORDS) this._recent.shift();
    this._recordTimes.push(now);
  }

  _resetMetrics() {
    this._packets = 0;
    this._frames = 0;
    this._decodeErrors = 0;
    this._lastPacketAt = null;
    this._recordTimes = [];
    this._latest = null;
    this._recent = [];
  }

  _stopScanState() {
    if (this._state === BleConnectionState.SCANNING) {
      this._setState(BleConnectionState.IDLE);
    }
  }

  _clearError() {
    this._errorCode = null;
    this._errorMessage = null;
    this._warning = null;
  }

  _fail(code, message, state = BleConnectionState.ERROR) {
    this._errorCode = code;
    this._errorMessage = message;
    this._setState(state);
    this._emit();
  }

  _setState(next) {
    if (next === this._state) return;
    if (!canTransition(this._state, next)) {
      // Keep the machine simple but never crash on an unexpected transition.
      this._warning = `Transición no prevista: ${this._state} → ${next}`;
    }
    this._state = next;
  }

  _buildSnapshot() {
    const capabilities = this._transport?.capabilities || null;
    const rate =
      this._recordTimes.length > 0
        ? this._recordTimes.length / (RATE_WINDOW_MS / 1000)
        : 0;
    return {
      state: this._state,
      stateLabel: STATE_LABELS[this._state] || this._state,
      initialized: this._initialized,
      capabilities,
      devices: this._devices.slice(),
      connectedDeviceId: this._connectedDeviceId,
      connectedDeviceName: this._connectedDeviceName,
      services: this._services.slice(),
      receiving: this._receiving,
      errorCode: this._errorCode,
      errorMessage: this._errorMessage,
      warning: this._warning,
      packets: this._packets,
      frames: this._frames,
      decodeErrors: this._decodeErrors,
      lastPacketAt: this._lastPacketAt,
      packetsPerSecond: Math.round(rate * 10) / 10,
      latest: this._latest,
      recent: this._recent.slice(),
      pendingBytes: this._decoder.pendingBytes,
      latestFrameHex: this._decoder.lastFrame
        ? bytesToHex(this._decoder.lastFrame)
        : null,
      rxCharacteristic: RACEBOX_RX_UUID,
      memory: this._memory,
      history: {
        phase: this._history.phase,
        expected: this._history.expected,
        received: this._history.received,
        error: this._history.error,
      },
    };
  }

  _emit() {
    this._snapshot = this._buildSnapshot();
    for (const listener of this._listeners) {
      try {
        listener();
      } catch (_) {
        /* a bad listener must not break BLE handling */
      }
    }
  }
}

export { BleError, BleErrorCode, BleConnectionState };
