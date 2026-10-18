// Capacitor BLE transport (iOS / Android).
//
// The plugin is imported dynamically so the PWA never loads or depends on it
// at runtime. All calls go through the plugin's BleClient wrapper, which owns
// permission requests and platform differences.
//
// Android permissions: we initialize with `androidNeverForLocation: true` so
// that on Android 12+ the app can scan without location permission. On
// Android <= 11 the plugin still needs location permission for scanning; the
// native manifest keeps ACCESS_*_LOCATION with maxSdkVersion=30 for that case.

import { BluetoothTransport } from '../BluetoothTransport.js';
import { BleError, BleErrorCode, normalizeBleError } from '../BleConnectionState.js';
import { normalizeCharacteristic, normalizeUuid } from '../BleDevice.js';

export class CapacitorBleTransport extends BluetoothTransport {
  constructor() {
    super();
    /** @type {any} */
    this.BleClient = null;
    this._initialized = false;
    this._scanning = false;
    /** @type {Map<string, (deviceId: string) => void>} */
    this._disconnectHandlers = new Map();
    this._connected = new Set();
  }

  get capabilities() {
    return {
      available: true,
      kind: 'capacitor',
      secureContext: true,
      supportsDeviceList: true,
      supportsRssi: true,
      supportsContinuousScan: true,
      unavailableReason: null,
    };
  }

  async _load() {
    if (this.BleClient) return this.BleClient;
    try {
      const mod = await import('@capacitor-community/bluetooth-le');
      this.BleClient = mod.BleClient;
      return this.BleClient;
    } catch (err) {
      throw new BleError(
        BleErrorCode.UNSUPPORTED,
        'No se pudo cargar el plugin BLE nativo.',
        err,
      );
    }
  }

  async initialize() {
    const BleClient = await this._load();
    try {
      await BleClient.initialize({ androidNeverForLocation: true });
      const enabled = await BleClient.isEnabled();
      if (!enabled) {
        throw new BleError(
          BleErrorCode.BLUETOOTH_OFF,
          'Bluetooth está desactivado en el dispositivo.',
        );
      }
      this._initialized = true;
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.NOT_INITIALIZED);
    }
  }

  async startScan(_options = {}, onDevice) {
    if (!this._initialized) await this.initialize();
    if (this._scanning) {
      throw new BleError(BleErrorCode.SCAN_FAILED, 'Ya hay un escaneo en curso.');
    }
    const BleClient = await this._load();
    this._scanning = true;
    try {
      await BleClient.requestLEScan(
        { allowDuplicates: false },
        (result) => {
          const device = result?.device || {};
          if (!device.deviceId) return;
          onDevice({
            id: device.deviceId,
            name: result.localName || device.name || null,
            rssi: typeof result.rssi === 'number' ? result.rssi : null,
            platform: 'capacitor',
            raw: result,
          });
        },
      );
    } catch (err) {
      this._scanning = false;
      throw normalizeBleError(err, BleErrorCode.SCAN_FAILED);
    }
  }

  async stopScan() {
    if (!this._scanning) return;
    this._scanning = false;
    const BleClient = await this._load();
    try {
      await BleClient.stopLEScan();
    } catch (_) {
      /* already stopped */
    }
  }

  async connect(deviceId, onDisconnect) {
    const BleClient = await this._load();
    try {
      // Stop scanning before connecting; some Android stacks refuse otherwise.
      await this.stopScan();
      await BleClient.connect(
        deviceId,
        (id) => {
          this._connected.delete(id);
          this._disconnectHandlers.delete(id);
          if (onDisconnect) onDisconnect(id);
        },
        { timeout: 10000 },
      );
      this._connected.add(deviceId);
      if (onDisconnect) this._disconnectHandlers.set(deviceId, onDisconnect);
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.CONNECT_FAILED);
    }
  }

  async discoverServices(deviceId) {
    const BleClient = await this._load();
    try {
      // On native this is explicit; iOS may throw if already discovered, which
      // is harmless because getServices() below still returns the tree.
      try {
        await BleClient.discoverServices(deviceId);
      } catch (_) {
        /* already discovered */
      }
      const services = await BleClient.getServices(deviceId);
      return (services || []).map((service) => ({
        uuid: normalizeUuid(service.uuid),
        isPrimary: true,
        characteristics: (service.characteristics || []).map((c) =>
          normalizeCharacteristic(c.uuid, c.properties),
        ),
      }));
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.UNKNOWN);
    }
  }

  async startNotifications(deviceId, serviceUuid, characteristicUuid, onData) {
    const BleClient = await this._load();
    try {
      await this.stopNotifications(deviceId, serviceUuid, characteristicUuid);
      await BleClient.startNotifications(
        deviceId,
        serviceUuid,
        characteristicUuid,
        (value) => {
          if (!value) return;
          const bytes = new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          );
          onData(bytes);
        },
      );
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.SUBSCRIBE_FAILED);
    }
  }

  async stopNotifications(deviceId, serviceUuid, characteristicUuid) {
    if (!this.BleClient) return;
    try {
      await this.BleClient.stopNotifications(
        deviceId,
        serviceUuid,
        characteristicUuid,
      );
    } catch (_) {
      /* not subscribed / already gone */
    }
  }

  async read(deviceId, serviceUuid, characteristicUuid) {
    const BleClient = await this._load();
    try {
      const value = await BleClient.read(deviceId, serviceUuid, characteristicUuid);
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.UNKNOWN);
    }
  }

  async write(deviceId, serviceUuid, characteristicUuid, data) {
    const BleClient = await this._load();
    try {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      await BleClient.write(deviceId, serviceUuid, characteristicUuid, view);
    } catch (err) {
      throw normalizeBleError(err, BleErrorCode.WRITE_FAILED);
    }
  }

  async disconnect(deviceId) {
    if (!this.BleClient) return;
    try {
      await this.BleClient.disconnect(deviceId);
    } catch (_) {
      /* already disconnected */
    } finally {
      this._connected.delete(deviceId);
      this._disconnectHandlers.delete(deviceId);
    }
  }

  async destroy() {
    await this.stopScan();
    if (!this.BleClient) return;
    for (const id of [...this._connected]) {
      await this.disconnect(id);
    }
    this._initialized = false;
  }
}
