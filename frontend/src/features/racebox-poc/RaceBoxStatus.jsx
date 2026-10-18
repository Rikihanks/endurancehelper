import {
  BleConnectionState,
  BleErrorCode,
} from '../../services/bluetooth/BleConnectionState.js';
import {
  RACEBOX_SERVICE_UUID,
  RACEBOX_TX_UUID,
  RACEBOX_RX_UUID,
} from '../../services/devices/racebox/RaceBoxProtocol.js';

const ERROR_HINTS = {
  [BleErrorCode.UNSUPPORTED]:
    'Web Bluetooth no está disponible en este navegador. En iOS usa la app nativa; en Android prueba Chrome.',
  [BleErrorCode.INSECURE_CONTEXT]:
    'Web Bluetooth exige HTTPS o localhost. Abre la app por HTTPS o en localhost.',
  [BleErrorCode.PERMISSION_DENIED]:
    'Permiso de Bluetooth denegado. Revísalo en los ajustes del sistema o del navegador.',
  [BleErrorCode.BLUETOOTH_OFF]:
    'Bluetooth desactivado. Actívalo y vuelve a intentarlo.',
  [BleErrorCode.USER_CANCELLED]:
    'Selección de dispositivo cancelada.',
  [BleErrorCode.CONNECT_FAILED]:
    'No se pudo conectar. Comprueba que la RaceBox esté encendida y cerca.',
  [BleErrorCode.SERVICE_NOT_FOUND]:
    'El dispositivo no expone el servicio Nordic UART esperado. ¿Es una RaceBox Mini S?',
  [BleErrorCode.CHARACTERISTIC_NOT_FOUND]:
    'No se encontró la característica de notificaciones (TX) de RaceBox.',
  [BleErrorCode.SUBSCRIBE_FAILED]:
    'No se pudo activar la recepción de notificaciones.',
  [BleErrorCode.DISCONNECTED]:
    'El dispositivo se ha desconectado.',
  [BleErrorCode.PROTOCOL_ERROR]:
    'Se recibieron paquetes que no cumplen el protocolo esperado.',
};

function StatePill({ state, label }) {
  return <span className={`rb-pill rb-pill-${state}`}>{label}</span>;
}

function Bool({ value, yes = 'sí', no = 'no' }) {
  return <span className={value ? 'rb-ok' : 'rb-off'}>{value ? yes : no}</span>;
}

function CapabilityGrid({ snapshot }) {
  const caps = snapshot.capabilities;
  if (!caps) {
    return <p className="rb-muted">Transporte BLE aún no inicializado.</p>;
  }
  const platformLabel =
    caps.kind === 'capacitor' ? 'App nativa (Capacitor)' : caps.kind === 'web' ? 'PWA (Web Bluetooth)' : 'No disponible';
  return (
    <div className="rb-grid">
      <div className="rb-kv"><span>Transporte</span><b>{platformLabel}</b></div>
      <div className="rb-kv"><span>BLE disponible</span><Bool value={caps.available} /></div>
      <div className="rb-kv"><span>Contexto seguro</span><Bool value={caps.secureContext} /></div>
      <div className="rb-kv"><span>Lista de dispositivos</span><Bool value={caps.supportsDeviceList} /></div>
      <div className="rb-kv"><span>RSSI</span><Bool value={caps.supportsRssi} /></div>
      <div className="rb-kv"><span>Escaneo continuo</span><Bool value={caps.supportsContinuousScan} /></div>
      {caps.unavailableReason && (
        <p className="rb-note rb-note-warn">{caps.unavailableReason}</p>
      )}
      {caps.kind === 'web' && (
        <p className="rb-note">
          Web Bluetooth abre el selector del navegador: sólo se obtiene el dispositivo elegido, sin
          lista continua ni RSSI. iOS Safari no lo soporta.
        </p>
      )}
    </div>
  );
}

function DeviceList({ snapshot, busy, onConnect }) {
  const canConnect = [
    BleConnectionState.SCANNING,
    BleConnectionState.IDLE,
    BleConnectionState.DISCONNECTED,
    BleConnectionState.ERROR,
  ].includes(snapshot.state);

  if (snapshot.devices.length === 0) {
    return (
      <p className="rb-muted">
        {snapshot.state === BleConnectionState.SCANNING
          ? 'Buscando dispositivos…'
          : 'Todavía no se ha detectado ningún dispositivo.'}
      </p>
    );
  }

  return (
    <table className="rb-table">
      <thead>
        <tr>
          <th>Nombre anunciado</th>
          <th>Identificador</th>
          <th>RSSI</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {snapshot.devices.map((device) => {
          const isConnected = snapshot.connectedDeviceId === device.id;
          return (
            <tr key={device.id} className={isConnected ? 'rb-row-active' : ''}>
              <td>{device.name || <span className="rb-muted">(sin nombre)</span>}</td>
              <td className="rb-mono rb-break">{device.id}</td>
              <td className="rb-mono">
                {device.rssi == null ? <span className="rb-muted">—</span> : `${device.rssi} dBm`}
              </td>
              <td className="rb-actions-cell">
                <button
                  type="button"
                  className="rb-btn rb-btn-primary"
                  disabled={!!busy || !canConnect || isConnected}
                  onClick={() => onConnect(device.id)}
                >
                  {isConnected ? 'Seleccionado' : 'Conectar'}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function GattTree({ services }) {
  if (!services || services.length === 0) {
    return <p className="rb-muted">GATT aún no descubierto (conecta a un dispositivo).</p>;
  }
  return (
    <div className="rb-gatt">
      {services.map((service) => {
        const isNus = service.uuid === RACEBOX_SERVICE_UUID;
        return (
          <div key={service.uuid} className={`rb-service${isNus ? ' rb-service-nus' : ''}`}>
            <div className="rb-service-head">
              <code>{service.uuid}</code>
              {isNus && <span className="rb-tag">Nordic UART (RaceBox)</span>}
            </div>
            <ul className="rb-char-list">
              {service.characteristics.map((c) => {
                const isTx = c.uuid === RACEBOX_TX_UUID;
                const isRx = c.uuid === RACEBOX_RX_UUID;
                return (
                  <li key={c.uuid}>
                    <code>{c.uuid}</code>
                    {isTx && <span className="rb-tag">TX · notificaciones</span>}
                    {isRx && <span className="rb-tag">RX · escritura</span>}
                    <span className="rb-props">
                      {c.read && <em>read</em>}
                      {c.write && <em>write</em>}
                      {c.writeWithoutResponse && <em>writeWithoutResponse</em>}
                      {c.notify && <em>notify</em>}
                      {c.indicate && <em>indicate</em>}
                      {!c.read && !c.write && !c.writeWithoutResponse && !c.notify && !c.indicate && (
                        <em className="rb-muted">sin propiedades declaradas</em>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function RaceBoxStatus({
  snapshot,
  busy,
  onRetryInit,
  onScan,
  onStopScan,
  onConnect,
  onDisconnect,
  onStartReceiving,
  onStopReceiving,
}) {
  const caps = snapshot.capabilities;
  const scanning = snapshot.state === BleConnectionState.SCANNING;
  const connected =
    snapshot.state === BleConnectionState.CONNECTED ||
    snapshot.state === BleConnectionState.RECEIVING;
  const receiving = snapshot.receiving;
  const canScan =
    !!caps &&
    caps.available &&
    [BleConnectionState.IDLE, BleConnectionState.DISCONNECTED, BleConnectionState.ERROR].includes(
      snapshot.state,
    ) &&
    !busy;

  const hint = snapshot.errorCode ? ERROR_HINTS[snapshot.errorCode] : null;

  return (
    <section className="rb-card">
      <div className="rb-card-head">
        <h2>Estado del dispositivo</h2>
        <StatePill state={snapshot.state} label={snapshot.stateLabel} />
      </div>

      <CapabilityGrid snapshot={snapshot} />

      {(snapshot.errorMessage || snapshot.warning) && (
        <div className={`rb-alert${snapshot.errorMessage ? ' rb-alert-error' : ' rb-alert-warn'}`}>
          <b>{snapshot.errorCode ? `Error (${snapshot.errorCode})` : 'Aviso'}:</b>{' '}
          {snapshot.errorMessage || snapshot.warning}
          {hint && <div className="rb-hint">{hint}</div>}
        </div>
      )}

      <div className="rb-toolbar">
        <button
          type="button"
          className="rb-btn"
          onClick={onRetryInit}
          disabled={!!busy || (snapshot.initialized && caps?.available !== false)}
        >
          Reintentar inicialización
        </button>
        <button type="button" className="rb-btn rb-btn-primary" onClick={onScan} disabled={!canScan}>
          Iniciar escaneo
        </button>
        <button type="button" className="rb-btn" onClick={onStopScan} disabled={!scanning || !!busy}>
          Detener escaneo
        </button>
        <button
          type="button"
          className="rb-btn rb-btn-primary"
          onClick={onStartReceiving}
          disabled={!connected || receiving || !!busy}
        >
          Iniciar recepción
        </button>
        <button
          type="button"
          className="rb-btn"
          onClick={onStopReceiving}
          disabled={!receiving || !!busy}
        >
          Detener recepción
        </button>
        <button
          type="button"
          className="rb-btn rb-btn-danger"
          onClick={onDisconnect}
          disabled={!connected || !!busy}
        >
          Desconectar
        </button>
      </div>

      <h3>Dispositivos detectados</h3>
      <DeviceList snapshot={snapshot} busy={busy} onConnect={onConnect} />

      <h3>Información GATT</h3>
      {snapshot.connectedDeviceId && (
        <p className="rb-muted">
          Conectado a <b>{snapshot.connectedDeviceName || '(sin nombre)'}</b>{' '}
          <span className="rb-mono">{snapshot.connectedDeviceId}</span>
          {snapshot.receiving && ' · suscripción TX activa'}
        </p>
      )}
      <GattTree services={snapshot.services} />
    </section>
  );
}
