// Bluetooth layer public entry point.
//
// Chooses the right transport at runtime:
//   native (Capacitor)  -> CapacitorBleTransport (plugin loaded lazily)
//   web with Web BT     -> WebBluetoothTransport
//   otherwise           -> UnavailableBleTransport (clear reason, no crash)
//
// The PWA never depends on Capacitor: on web only navigator.bluetooth is used.

import { createWebBluetoothTransport } from './transports/WebBluetoothTransport.js';
import { CapacitorBleTransport } from './transports/CapacitorBleTransport.js';

/** True when the app is running inside a Capacitor native container. */
export function isNativePlatform() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform();
    if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web';
  } catch (_) {
    /* fall through */
  }
  return false;
}

/** 'web' | 'capacitor' — for display only. */
export function runtimePlatform() {
  return isNativePlatform() ? 'capacitor' : 'web';
}

/**
 * Create the appropriate transport. Async because the native plugin is
 * imported dynamically (keeping it out of the PWA's initial load).
 * @returns {Promise<import('./BluetoothTransport.js').BluetoothTransport>}
 */
export async function createBluetoothTransport() {
  if (isNativePlatform()) {
    return new CapacitorBleTransport();
  }
  return createWebBluetoothTransport();
}

export { BluetoothTransport, UnavailableBleTransport, findCharacteristic } from './BluetoothTransport.js';
export {
  BleConnectionState,
  BleError,
  BleErrorCode,
  normalizeBleError,
  canTransition,
  ALLOWED_TRANSITIONS,
  STATE_LABELS,
} from './BleConnectionState.js';
export { WebBluetoothTransport } from './transports/WebBluetoothTransport.js';
export { CapacitorBleTransport } from './transports/CapacitorBleTransport.js';
