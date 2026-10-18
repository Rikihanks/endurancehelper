// Shared types and small factories for RaceBox decoded data.
// Plain JS + JSDoc typedefs (the project has no TypeScript toolchain).

/**
 * @typedef {Object} RawFrame
 * @property {number} cls  UBX class (0xFF for RaceBox)
 * @property {number} id   UBX message id (0x01 live, 0x21 history, ...)
 * @property {number} length Payload length in bytes
 * @property {Uint8Array} payload Raw payload bytes
 * @property {Uint8Array} frame  Full raw frame (sync..checksum)
 */

/**
 * One decoded RaceBox data record (live or history share the same payload).
 * @typedef {Object} RaceBoxRecord
 * @property {number} iTOW            GPS time of week (ms)
 * @property {number} year
 * @property {number} month
 * @property {number} day
 * @property {number} hour
 * @property {number} minute
 * @property {number} second
 * @property {number} validityFlags    bit0 valid date, bit1 valid time, bit2 fully resolved
 * @property {number} timeAccuracyNs  Time accuracy (ns)
 * @property {number} nanoseconds     Signed sub-second nanoseconds (can be negative)
 * @property {number} fixStatus       0=no fix, 2=2D, 3=3D
 * @property {number} fixFlags        Fix status flags: bit0 = valid fix, bit5 = valid heading
 * @property {number} dateTimeFlags   Date/Time flags (bits 5..7 confirm UTC date/time)
 * @property {number} numSVs
 * @property {number} latitude        degrees
 * @property {number} longitude       degrees
 * @property {number} altitude        metres above MSL
 * @property {number} wgsAltitude     metres above WGS84 ellipsoid
 * @property {number} horizontalAccuracy metres (payload stores mm)
 * @property {number} verticalAccuracy   metres (payload stores mm)
 * @property {number} speed           km/h
 * @property {number} heading         degrees 0..360
 * @property {number} speedAccuracy   km/h
 * @property {number} headingAccuracy degrees
 * @property {number} pdop            DOP x 100
 * @property {number} latLonFlags     bit0 = 1 -> lat/lon/altitudes invalid; bits4..1 diff age
 * @property {number} gForceX         mG
 * @property {number} gForceY         mG
 * @property {number} gForceZ         mG
 * @property {number} rotRateX        centi-deg/s (deg/s x 100)
 * @property {number} rotRateY        centi-deg/s (deg/s x 100)
 * @property {number} rotRateZ        centi-deg/s (deg/s x 100)
 * @property {number} batteryLevel    0..100 %
 * @property {boolean} charging
 * @property {number} receivedAt      Date.now() when decoded
 */

/**
 * Typed decoded message emitted by the decoder.
 * @typedef {Object} DecodedMessage
 * @property {'live'|'history'|'ack'|'nack'|'status'|'download'|'erase'|'recConfig'|'stateChange'|'unknown'} kind
 * @property {number} id
 * @property {Uint8Array} [payload]  Raw payload for command responses
 * @property {RaceBoxRecord} [record]
 */

/**
 * Whether the device marks the coordinates as valid. This is the authoritative
 * signal: Lat/Lon Flags bit0 = 1 means "latitude/longitude/altitudes invalid"
 * (RaceBox BLE Protocol rev 9, payload offset 66).
 * @param {RaceBoxRecord} r
 */
export function coordinatesValid(r) {
  if (!r) return false;
  return (r.latLonFlags & 0x01) === 0;
}

/**
 * Whether there is a usable position fix.
 *
 * Note: we do NOT rely on fixStatus/fixFlags alone. A real RaceBox Mini S has
 * been observed reporting `fixStatus = 0` and `Fix Status Flags = 0x00` while
 * still streaming valid coordinates with 7 satellites and 8.5 m accuracy. The
 * device's own Lat/Lon Flags remain the reliable validity indicator, so we use
 * them plus a sane satellite count (the vendor's own guidance needs >= 4 SVs).
 * @param {RaceBoxRecord} r
 */
export function isPositionValid(r) {
  if (!r) return false;
  return coordinatesValid(r) && r.numSVs >= 4;
}

/**
 * Whether fixStatus/fixFlags report a "good" 3D solution per the official
 * recommendation (Fix Status Flags bit0 set AND Fix Status === 3). Informational
 * only: some firmware does not set these fields in live packets.
 * @param {RaceBoxRecord} r
 */
export function hasGnssFixFlag(r) {
  if (!r) return false;
  return r.fixStatus === 3 && (r.fixFlags & 0x01) === 1;
}

/**
 * Whether a fix status means the position is usable (legacy: status only).
 * @param {number} fixStatus
 */
export function hasFix(fixStatus) {
  return fixStatus >= 2;
}

/**
 * Validity Flags bit0 = valid date, bit1 = valid time.
 * @param {RaceBoxRecord} r
 */
export function hasValidTime(r) {
  if (!r) return false;
  return (r.validityFlags & 0x01) === 1 && (r.validityFlags & 0x02) === 2;
}

/** Degrees of longitude/latitude per LSB. */
export const LATLON_SCALE = 1e-7;
/** Altitude is stored in millimetres. */
export const ALT_MM_SCALE = 0.001;
/** Speed is stored in mm/s -> km/h. */
export const MMPS_TO_KMH = 3.6 / 1000;
/** Heading (and heading accuracy) is stored as degrees x 1e5. */
export const HEADING_SCALE = 1e-5;
