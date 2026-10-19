import { useState } from 'react';

export default function RaceBoxConnector({ live }) {
  const [selected, setSelected] = useState('');
  const devices = (live.snapshot.devices || []).slice(0, 12);
  const connected = !!live.snapshot.connectedDeviceId;

  return (
    <div className="live-rb">
      <div className="live-rb-status">
        <span className={`live-rb-dot ${connected ? 'is-on' : ''}`} />
        <span>
          {live.snapshot.connectionState}
          {connected ? (live.snapshot.receiving ? ' · recibiendo' : ' · conectado') : ''}
        </span>
      </div>

      <div className="live-rb-actions">
        {!connected && (
          <button type="button" onClick={live.scan}>Escanear</button>
        )}
        {!connected && devices.length > 0 && (
          <>
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Selecciona…</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name || device.localName || device.id}
                </option>
              ))}
            </select>
            <button type="button" disabled={!selected} onClick={() => live.connect(selected)}>Conectar</button>
          </>
        )}
        {connected && (
          <button type="button" onClick={live.disconnect}>Desconectar</button>
        )}
      </div>
    </div>
  );
}
