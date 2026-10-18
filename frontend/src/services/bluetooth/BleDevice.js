// Normalized BLE device shape and service/characteristic types.
// Both transports (Web Bluetooth and the Capacitor plugin) normalize into these
// shapes so the UI never sees GATT platform details.

/**
 * @typedef {Object} BleDevice
 * @property {string} id            Stable platform id (Web: device.id, native: deviceId)
 * @property {string|null} name     Advertised name if available
 * @property {number|null} rssi     Signal strength if the platform provides it
 * @property {string} platform      'web' | 'capacitor'
 * @property {any} [raw]            Original platform object (not for UI use)
 */

/**
 * @typedef {Object} BleCharacteristic
 * @property {string} uuid
 * @property {boolean} read
 * @property {boolean} write
 * @property {boolean} writeWithoutResponse
 * @property {boolean} notify
 * @property {boolean} indicate
 */

/**
 * @typedef {Object} BleService
 * @property {string} uuid
 * @property {boolean} isPrimary
 * @property {BleCharacteristic[]} characteristics
 */

/**
 * @param {string} uuid
 * @returns {string} lower-case UUID
 */
export function normalizeUuid(uuid) {
  return String(uuid || '').toLowerCase();
}

/**
 * Compare two UUIDs case-insensitively.
 * @param {string} a
 * @param {string} b
 */
export function uuidEquals(a, b) {
  return normalizeUuid(a) === normalizeUuid(b);
}

function toPropertyMap(properties) {
  if (Array.isArray(properties)) {
    return Object.fromEntries(properties.map((k) => [k, true]));
  }
  return properties || {};
}

/**
 * Normalize a platform characteristic. Web Bluetooth exposes
 * `properties` as an object of booleans; the Capacitor plugin may expose the
 * same object or an array of strings.
 * @param {string} uuid
 * @param {any} properties
 * @returns {BleCharacteristic}
 */
export function normalizeCharacteristic(uuid, properties) {
  const p = toPropertyMap(properties);
  const has = (k) => p[k] === true || p[k] === k;
  return {
    uuid: normalizeUuid(uuid),
    read: has('read'),
    write: has('write'),
    writeWithoutResponse: has('writeWithoutResponse') || has('writeNoResponse'),
    notify: has('notify'),
    indicate: has('indicate'),
  };
}
