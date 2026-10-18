// Web Bluetooth transport (PWA). Uses navigator.bluetooth directly, with no
// Capacitor dependency.
//
// Platform realities:
//   - Web Bluetooth requires a secure context (https:// or localhost).
//   - requestDevice() opens a browser picker and returns ONE device; there is
//     no continuous device list and no RSSI. supportsDeviceList = false.
//   - Not available on iOS Safari (or any iOS browser today); Android Chrome
//     supports it. The UI must surface this, not fail silently.

import {
  BluetoothTransport,
  UnavailableBleTransport,
} from '../BluetoothTransport.js';
import { BleError, BleErrorCode, normalizeBleError } from '../BleConnectionState.js';
import {
  normalizeCharacteristic,
  normalizeUuid,
} from '../BleDevice.js';

const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

export class WebBluetoothTransport extends BluetoothTransport {
  constructor() {
    super();
    /** @type {Map<string, any>} deviceId -> BluetoothDevice */
    this._devices = new Map();
    /** @type {Map<string, any>} deviceId -> BluetoothRemoteGATTServer */
    this._servers = new Map();
    /** @type {Map<string, { characteristic: any, handler: (e: any) => void }>} */
    this._subscriptions = new Map();
    this._scanning = false;
    this._initialized = false;
  }

  static isSupported() {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.bluetooth &&
      (typeof window === 'undefined' || window.isSecureContext !== false)
    );
  }

  get capabilities() {
    const secure = typeof window !== 'undefined' ? !!window.isSecureContext : true;
    const hasApi = typeof navigator !== 'undefined' && !!navigator.bluetooth;
    const available = hasApi && secure;
    return {
      available,
      kind: 'web',
      secureContext: secure,
      supportsDeviceList: false,
      supportsRssi: false,
      supportsContinuousScan: false,
      unavailableReason: available
        ? null
        : !secure
          ? 'Web Bluetooth requiere HTTPS o localhost.'
          : 'Este navegador no soporta Web Bluetooth (p. ej. Safari/iOS).',
    };
  }

  async initialize() {
    if (!this.capabilities.available) {
      throw new BleError(
        this.capabilities.secureContext
          ? BleErrorCode.UNSUPPORTED
          : BleErrorCode.INSECURE_CONTEXT,
        this.capabilities.unavailableReason || 'Web Bluetooth no disponible',
      );
    }
    if (typeof navigator.bluetooth.getAvailability === 'function') {
      try {
        const ok = await navigator.bluetooth.getAvailability();
        if (!ok) {
          throw new BleError(
            BleErrorCode.BLUETOOTH_OFF,
            'Bluetooth está desactivado en el sistema.',
          );
        }
      } catch (err) {
        if (err instanceof BleError) throw err;
        // getAvailability is advisory; ignore browser quirks.
      }
    }
    this._initialized = true;
  }

  async startScan(_options = {}, onDevice) {
    if (!this._initialized) await this.initialize();
    if (this._scanning) {
      throw new BleError(BleErrorCode.SCAN_FAILED, 'Ya hay un escaneo en curso.');
    }
    this._scanning = true;
    try {
      const device = await navigator.bluetooth.requestDevice({
        // The browser picker does the selection. Accept all so a device whose
        // advertised name does not start with "RaceBox" is still reachable;
        // the UI shows the name and the user picks the right one.
        acceptAllDevices: true,
        optionalServices: [NUS_SERVICE],
      });
      this._devices.set(device.id, device);
      onDevice({
        id: device.id,
        name: device.name || null,
        rssi: null,
        platform: 'web',
        raw: device,
      });
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.SCAN_FAILED);
    } finally {
      this._scanning = false;
    }
  }

  async stopScan() {
    // Web Bluetooth's picker cannot be cancelled programmatically.
    this._scanning = false;
  }

  async connect(deviceId, onDisconnect) {
    const device = this._devices.get(deviceId);
    if (!device) {
      throw new BleError(
        BleErrorCode.CONNECT_FAILED,
        'Dispositivo desconocido; vuelve a seleccionarlo.',
      );
    }
    try {
      const server = await device.gatt.connect();
      this._servers.set(deviceId, server);
      const handler = () => {
        this._subscriptions.delete(deviceId);
        this._servers.delete(deviceId);
        if (onDisconnect) onDisconnect(deviceId);
      };
      device.addEventListener('gattserverdisconnected', handler);
      // Keep the handler reachable for destroy().
      server.__disconnectHandler = handler;
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.CONNECT_FAILED);
    }
  }

  async discoverServices(deviceId) {
    const server = this._requireServer(deviceId);
    try {
      const primary = await server.getPrimaryServices();
      const out = [];
      for (const service of primary) {
        const characteristics = await service.getCharacteristics();
        out.push({
          uuid: normalizeUuid(service.uuid),
          isPrimary: !!service.isPrimary,
          characteristics: characteristics.map((c) =>
            normalizeCharacteristic(c.uuid, c.properties),
          ),
        });
      }
      return out;
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.UNKNOWN);
    }
  }

  async startNotifications(deviceId, serviceUuid, characteristicUuid, onData) {
    const { characteristic } = await this._resolveCharacteristic(
      deviceId,
      serviceUuid,
      characteristicUuid,
    );
    try {
      // Remove a previous subscription for the same characteristic first.
      await this.stopNotifications(deviceId, serviceUuid, characteristicUuid);
      await characteristic.startNotifications();
      const handler = (event) => {
        const value = event.target.value;
        if (!value) return;
        const bytes = new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        );
        onData(bytes);
      };
      characteristic.addEventListener('characteristicvaluechanged', handler);
      this._subscriptions.set(deviceId, { characteristic, handler });
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.SUBSCRIBE_FAILED);
    }
  }

  async stopNotifications(deviceId, _serviceUuid, _characteristicUuid) {
    const sub = this._subscriptions.get(deviceId);
    if (!sub) return;
    this._subscriptions.delete(deviceId);
    try {
      sub.characteristic.removeEventListener(
        'characteristicvaluechanged',
        sub.handler,
      );
      await sub.characteristic.stopNotifications();
    } catch (_) {
      /* the device may already be gone */
    }
  }

  async read(deviceId, serviceUuid, characteristicUuid) {
    const { characteristic } = await this._resolveCharacteristic(
      deviceId,
      serviceUuid,
      characteristicUuid,
    );
    try {
      const view = await characteristic.readValue();
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.UNKNOWN);
    }
  }

  async write(deviceId, serviceUuid, characteristicUuid, data) {
    const { characteristic } = await this._resolveCharacteristic(
      deviceId,
      serviceUuid,
      characteristicUuid,
    );
    try {
      if (characteristic.properties?.writeWithoutResponse) {
        await characteristic.writeValueWithoutResponse(data);
      } else {
        await characteristic.writeValueWithResponse(data);
      }
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.WRITE_FAILED);
    }
  }

  async disconnect(deviceId) {
    await this.stopNotifications(deviceId);
    const server = this._servers.get(deviceId);
    const device = this._devices.get(deviceId);
    this._servers.delete(deviceId);
    try {
      if (server && server.connected) server.disconnect();
      else if (device?.gatt?.connected) device.gatt.disconnect();
    } catch (_) {
      /* already disconnected */
    }
  }

  async destroy() {
    for (const id of [...this._servers.keys()]) {
      await this.disconnect(id);
    }
    this._devices.clear();
    this._initialized = false;
  }

  _requireServer(deviceId) {
    const server = this._servers.get(deviceId);
    if (!server || !server.connected) {
      throw new BleError(BleErrorCode.DISCONNECTED, 'No hay conexión GATT activa.');
    }
    return server;
  }

  async _resolveCharacteristic(deviceId, serviceUuid, characteristicUuid) {
    const server = this._requireServer(deviceId);
    const service = await server.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);
    if (!characteristic) {
      throw new BleError(
        BleErrorCode.CHARACTERISTIC_NOT_FOUND,
        `Característica ${characteristicUuid} no encontrada`,
      );
    }
    return { service, characteristic };
  }
}

/** Build the correct web transport or an unavailable one with a reason. */
export function createWebBluetoothTransport() {
  if (WebBluetoothTransport.isSupported()) return new WebBluetoothTransport();
  const secure = typeof window !== 'undefined' ? !!window.isSecureContext : true;
  return new UnavailableBleTransport(
    secure
      ? 'Este navegador no soporta Web Bluetooth. En iOS usa la app nativa; en Android prueba Chrome.'
      : 'Web Bluetooth requiere HTTPS o localhost.',
    secure ? BleErrorCode.UNSUPPORTED : BleErrorCode.INSECURE_CONTEXT,
  );
}
