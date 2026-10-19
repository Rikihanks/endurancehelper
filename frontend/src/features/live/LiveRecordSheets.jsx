import { useState } from 'react';
import { IconX } from '@tabler/icons-react';

export function CircuitPicker({ tracks, activeTrackId, onConfirm, onClose }) {
  const [selected, setSelected] = useState(activeTrackId || '');

  return (
    <div className="live-sheet">
      <div className="live-sheet-card">
        <h3>Elige circuito</h3>
        <p className="live-sheet-hint">Obligatorio para grabar y cronometrar.</p>

        <div className="live-track-list">
          {tracks.length === 0 && (
            <p className="live-sheet-hint">No hay circuitos. Crea uno en Circuitos del PoC.</p>
          )}
          {tracks.map((track) => (
            <button
              key={track.id}
              type="button"
              className={`live-track-item ${selected === track.id ? 'is-active' : ''}`}
              onClick={() => setSelected(track.id)}
            >
              <span className="live-track-name">{track.name}</span>
              {track.id === activeTrackId ? <span className="live-track-tag">activo</span> : null}
            </button>
          ))}
        </div>

        <div className="live-sheet-actions">
          <button type="button" className="live-sheet-btn" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="live-sheet-btn is-primary"
            disabled={!selected}
            onClick={() => onConfirm(selected)}
          >
            Empezar a grabar
          </button>
        </div>
      </div>
    </div>
  );
}

export function StopDialog({ busy, onCancel, onConfirm }) {
  return (
    <div className="live-sheet">
      <div className="live-sheet-card">
        <h3>¿Detener la grabación?</h3>
        <p className="live-sheet-hint">Se guardará la sesión en el dispositivo.</p>
        <div className="live-sheet-actions">
          <button type="button" className="live-sheet-btn" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" className="live-sheet-btn is-danger" onClick={onConfirm} disabled={busy}>Detener</button>
        </div>
      </div>
    </div>
  );
}

export function RecordBanner({ kind = 'info', children, onClose, action }) {
  return (
    <div className={`live-banner live-banner-${kind}`}>
      <span className="live-banner-text">{children}</span>
      {action}
      {onClose ? (
        <button type="button" className="live-banner-close" onClick={onClose} aria-label="Cerrar">
          <IconX size={16} />
        </button>
      ) : null}
    </div>
  );
}
