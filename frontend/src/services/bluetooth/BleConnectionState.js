// Connection state machine values and error classification shared by the
// transport layer, the RaceBox adapter and the React UI.

export const BleConnectionState = Object.freeze({
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  SCANNING: 'scanning',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECEIVING: 'receiving',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
});

export const BleErrorCode = Object.freeze({
  UNSUPPORTED: 'unsupported',
  INSECURE_CONTEXT: 'insecure_context',
  NOT_INITIALIZED: 'not_initialized',
  PERMISSION_DENIED: 'permission_denied',
  BLUETOOTH_OFF: 'bluetooth_off',
  USER_CANCELLED: 'user_cancelled',
  SCAN_FAILED: 'scan_failed',
  CONNECT_FAILED: 'connect_failed',
  DISCONNECTED: 'disconnected',
  SERVICE_NOT_FOUND: 'service_not_found',
  CHARACTERISTIC_NOT_FOUND: 'characteristic_not_found',
  SUBSCRIBE_FAILED: 'subscribe_failed',
  WRITE_FAILED: 'write_failed',
  PROTOCOL_ERROR: 'protocol_error',
  UNKNOWN: 'unknown',
});

export class BleError extends Error {
  /**
   * @param {string} code One of BleErrorCode
   * @param {string} message
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'BleError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Translate platform errors (DOMException from Web Bluetooth, plugin errors)
 * into a BleError while preserving a useful message.
 * @param {unknown} err
 * @param {string} [fallbackCode]
 * @returns {BleError}
 */
export function normalizeBleError(err, fallbackCode = BleErrorCode.UNKNOWN) {
  if (err instanceof BleError) return err;

  const name = err && typeof err === 'object' ? err.name : '';
  const message =
    (err && typeof err === 'object' && (err.message || err.errorMessage)) ||
    String(err || 'Unknown Bluetooth error');

  let code = fallbackCode;
  if (name === 'NotFoundError') code = BleErrorCode.USER_CANCELLED;
  else if (name === 'NotAllowedError' || name === 'SecurityError')
    code = BleErrorCode.PERMISSION_DENIED;
  else if (name === 'NetworkError') code = BleErrorCode.CONNECT_FAILED;
  else if (name === 'NotSupportedError') code = BleErrorCode.UNSUPPORTED;
  else if (/permission|denied|not allowed/i.test(message))
    code = BleErrorCode.PERMISSION_DENIED;
  else if (/bluetooth.*(off|disabled)|adapter.*off/i.test(message))
    code = BleErrorCode.BLUETOOTH_OFF;
  else if (/cancel/i.test(message)) code = BleErrorCode.USER_CANCELLED;

  return new BleError(code, message, err);
}

/**
 * State transition rules for the simple PoC state machine. The adapter is the
 * only caller; keeping the table here makes transitions testable.
 */
export const ALLOWED_TRANSITIONS = Object.freeze({
  [BleConnectionState.IDLE]: [
    BleConnectionState.INITIALIZING,
    BleConnectionState.SCANNING,
    BleConnectionState.CONNECTING,
    BleConnectionState.ERROR,
  ],
  [BleConnectionState.INITIALIZING]: [
    BleConnectionState.IDLE,
    BleConnectionState.SCANNING,
    BleConnectionState.ERROR,
  ],
  [BleConnectionState.SCANNING]: [
    BleConnectionState.IDLE,
    BleConnectionState.CONNECTING,
    BleConnectionState.ERROR,
  ],
  [BleConnectionState.CONNECTING]: [
    BleConnectionState.CONNECTED,
    BleConnectionState.DISCONNECTED,
    BleConnectionState.ERROR,
  ],
  [BleConnectionState.CONNECTED]: [
    BleConnectionState.RECEIVING,
    BleConnectionState.DISCONNECTED,
    BleConnectionState.ERROR,
  ],
  [BleConnectionState.RECEIVING]: [
    BleConnectionState.CONNECTED,
    BleConnectionState.DISCONNECTED,
    BleConnectionState.ERROR,
  ],
  [BleConnectionState.DISCONNECTED]: [
    BleConnectionState.IDLE,
    BleConnectionState.SCANNING,
    BleConnectionState.CONNECTING,
    BleConnectionState.ERROR,
  ],
  [BleConnectionState.ERROR]: [
    BleConnectionState.IDLE,
    BleConnectionState.SCANNING,
    BleConnectionState.CONNECTING,
    BleConnectionState.INITIALIZING,
  ],
});

/**
 * @param {string} from
 * @param {string} to
 */
export function canTransition(from, to) {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export const STATE_LABELS = Object.freeze({
  [BleConnectionState.IDLE]: 'Inactivo',
  [BleConnectionState.INITIALIZING]: 'Inicializando BLE…',
  [BleConnectionState.SCANNING]: 'Escaneando…',
  [BleConnectionState.CONNECTING]: 'Conectando…',
  [BleConnectionState.CONNECTED]: 'Conectado',
  [BleConnectionState.RECEIVING]: 'Recibiendo datos',
  [BleConnectionState.DISCONNECTED]: 'Desconectado',
  [BleConnectionState.ERROR]: 'Error',
});
