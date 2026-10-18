// BluetoothTransport — generic BLE transport contract.
//
// Implementations:
//   - WebBluetoothTransport   (PWA, navigator.bluetooth)
//   - CapacitorBleTransport   (@capacitor-community/bluetooth-le, native only)
//   - UnavailableBleTransport (no BLE available; reports a clear reason)
//
// Nothing in this layer knows about RaceBox. The UI consumes typed events from
// the RaceBoxAdapter, never GATT packets.

import {
  BleError,
  BleErrorCode,
  normalizeBleError,
} from './BleConnectionState.js';
import { normalizeUuid, uuidEquals } from './BleDevice.js';

/**
 * @typedef {Object} TransportCapabilities
 * @property {boolean} available
 * @property {'web'|'capacitor'|'none'} kind
 * @property {boolean} secureContext
 * @property {boolean} supportsDeviceList  Web picker = false; native scan = true
 * @property {boolean} supportsRssi
 * @property {boolean} supportsContinuousScan
 * @property {string|null} unavailableReason
 */

export class BluetoothTransport {
  /** @returns {TransportCapabilities} */
  get capabilities() {
    throw new Error('not implemented');
  }

  /** @returns {Promise<void>} */
  async initialize() {}

  /**
   * Discover devices. For transports with a picker this resolves after the
   * user picks a device and invokes onDevice once.
   * @param {{ namePrefix?: string, timeoutMs?: number }} _options
   * @param {(device: import('./BleDevice.js').BleDevice) => void} _onDevice
   * @returns {Promise<void>}
   */
  async startScan(_options, _onDevice) {
    throw new Error('not implemented');
  }

  async stopScan() {}

  /**
   * @param {string} _deviceId
   * @param {(deviceId: string) => void} [_onDisconnect]
   * @returns {Promise<void>}
   */
  async connect(_deviceId, _onDisconnect) {
    throw new Error('not implemented');
  }

  /**
   * @param {string} _deviceId
   * @returns {Promise<import('./BleDevice.js').BleService[]>}
   */
  async discoverServices(_deviceId) {
    throw new Error('not implemented');
  }

  /**
   * @param {string} _deviceId
   * @param {string} _service
   * @param {string} _characteristic
   * @param {(data: Uint8Array) => void} _onData
   * @returns {Promise<void>}
   */
  async startNotifications(_deviceId, _service, _characteristic, _onData) {
    throw new Error('not implemented');
  }

  async stopNotifications(_deviceId, _service, _characteristic) {}

  /**
   * @param {string} _deviceId
   * @param {string} _service
   * @param {string} _characteristic
   * @returns {Promise<Uint8Array>}
   */
  async read(_deviceId, _service, _characteristic) {
    throw new Error('not implemented');
  }

  /**
   * @param {string} _deviceId
   * @param {string} _service
   * @param {string} _characteristic
   * @param {Uint8Array} _data
   * @returns {Promise<void>}
   */
  async write(_deviceId, _service, _characteristic, _data) {
    throw new Error('not implemented');
  }

  async disconnect(_deviceId) {}

  async destroy() {}
}

/** A transport used when the platform has no BLE support at all. */
export class UnavailableBleTransport extends BluetoothTransport {
  /**
   * @param {string} reason
   * @param {string} code
   */
  constructor(reason, code = BleErrorCode.UNSUPPORTED) {
    super();
    this._reason = reason;
    this._code = code;
  }

  get capabilities() {
    return {
      available: false,
      kind: 'none',
      secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
      supportsDeviceList: false,
      supportsRssi: false,
      supportsContinuousScan: false,
      unavailableReason: this._reason,
    };
  }

  async initialize() {
    throw new BleError(this._code, this._reason);
  }

  async startScan() {
    throw new BleError(this._code, this._reason);
  }
}

/**
 * Find the NUS service/characteristic in a discovered service list.
 * @param {import('./BleDevice.js').BleService[]} services
 * @param {string} serviceUuid
 * @param {string} characteristicUuid
 */
export function findCharacteristic(services, serviceUuid, characteristicUuid) {
  const service = (services || []).find((s) => uuidEquals(s.uuid, serviceUuid));
  if (!service) {
    throw new BleError(
      BleErrorCode.SERVICE_NOT_FOUND,
      `Servicio ${normalizeUuid(serviceUuid)} no encontrado`,
    );
  }
  const characteristic = (service.characteristics || []).find((c) =>
    uuidEquals(c.uuid, characteristicUuid),
  );
  if (!characteristic) {
    throw new BleError(
      BleErrorCode.CHARACTERISTIC_NOT_FOUND,
      `Característica ${normalizeUuid(characteristicUuid)} no encontrada`,
    );
  }
  return characteristic;
}

export { BleError, BleErrorCode, normalizeBleError };
