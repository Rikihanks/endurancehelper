import { useEffect, useRef, useState } from 'react';
import { TrackStore } from '../../../services/storage/TrackStore.js';
import { SessionStore } from '../../../services/storage/SessionStore.js';
import { LiveTiming } from '../../../services/devices/racebox/RaceBoxLiveTiming.js';
import { sessionStats, formatLapTime } from '../../../services/devices/racebox/RaceBoxAnalysis.js';

// Live lap timer: consumes the BLE live stream, times laps and sectors against
// the active track's traps and shows current/last/best lap, delta and pop-ups,
// like the "Lap Timer" screen of RaceBox/RaceChrono. It can also record the run
// to the local session store for later analysis.

function deltaText(deltaS) {
  if (deltaS == null || !Number.isFinite(deltaS)) return '—';
  const sign = deltaS >= 0 ? '+' : '−';
  return `${sign}${Math.abs(deltaS).toFixed(3)}`;
}

export default function LiveTimingView({ adapter, snapshot, activeTrackId, onGoToTracks }) {
  const [track, setTrack] = useState(null);
  const [ui, setUi] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [tick, setTick] = useState(0);
  const [maxSpeed, setMaxSpeed] = useState(0);

  const engineRef = useRef(null);
  const recordingRef = useRef(false);
  const recordsRef = useRef([]);
  const lastEventRef = useRef(null);
  const dashRef = useRef(null);
  const maxSpeedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    if (!activeTrackId) {
      setTrack(null);
      return undefined;
    }
    TrackStore.get(activeTrackId).then((t) => {
      if (!cancelled) setTrack(t);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTrackId]);

  useEffect(() => {
    engineRef.current = new LiveTiming(track);
    setUi(engineRef.current.getSnapshot());
  }, [track]);

  // One subscription for the lifetime of the view; the recording flag is read
  // through a ref so the listener never goes stale.
  useEffect(() => {
    const unsubscribe = adapter.addRecordListener((record) => {
      if (!recordingRef.current) return;
      const engine = engineRef.current;
      if (!engine) return;
      const event = engine.push(record);
      if (event) lastEventRef.current = event;
      if (record.speed > maxSpeedRef.current) maxSpeedRef.current = record.speed;
      recordsRef.current.push(record);
    });
    return () => unsubscribe();
  }, [adapter]);

  // Throttled UI refresh: the stream runs at up to 25 Hz, React should not.
  useEffect(() => {
    const timer = setInterval(() => {
      if (engineRef.current) setUi(engineRef.current.getSnapshot());
      setMaxSpeed(maxSpeedRef.current);
      setRecordCount(recordsRef.current.length);
      setTick((t) => t + 1);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  const connected = !!snapshot.connectedDeviceId;
  const receiving = snapshot.receiving;
  const latest = snapshot.latest;
  const event = lastEventRef.current;
  const eventFresh = event && Date.now() - (engineRef.current?.eventAt || 0) < 4000;

  async function start() {
    if (busy) return;
    setBusy('start');
    setError(null);
    setMessage(null);
    try {
      if (!connected) throw new Error('Conecta con la RaceBox en la pestaña En vivo.');
      if (!receiving) await adapter.startReceiving();
      recordsRef.current = [];
      lastEventRef.current = null;
      maxSpeedRef.current = 0;
      setMaxSpeed(0);
      engineRef.current = new LiveTiming(track);
      recordingRef.current = true;
      setRecording(true);
      // Jump straight to the times dashboard: no manual scrolling while driving.
      setTimeout(() => {
        if (dashRef.current) {
          try {
            dashRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (_) {
            dashRef.current.scrollIntoView();
          }
        }
      }, 60);
      if (!track || !track.startFinish) {
        setMessage(
          'Grabando sin circuito: la sesión se guardará completa, pero no se cronometran vueltas. ' +
            'Al terminar, créate el circuito en «Circuitos → Crear circuito desde una sesión».',
        );
      } else {
        setMessage('Grabando. Cruza la línea de meta para empezar a cronometrar.');
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(null);
    }
  }

  async function stopAndSave() {
    if (busy) return;
    setBusy('stop');
    setError(null);
    try {
      recordingRef.current = false;
      setRecording(false);
      const records = recordsRef.current;
      if (records.length < 2) {
        setMessage('No se grabó nada que guardar.');
        return;
      }
      const engine = engineRef.current;
      const stats = sessionStats(records, []);
      await SessionStore.save({
        meta: {
          name: `Directo ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${track ? ` · ${track.name}` : ''}`,
          deviceName: snapshot.connectedDeviceName,
          deviceId: snapshot.connectedDeviceId,
          source: 'live',
          startedAt: stats.startDate ? stats.startDate.toISOString() : null,
          durationS: stats.durationS,
          distanceM: stats.distanceM,
          maxSpeed: stats.maxSpeed,
          maxG: stats.maxG,
          lapCount: engine ? engine.laps.length : null,
          bestLapS: engine ? engine.bestLapS : null,
        },
        records,
      });
      setMessage(`Sesión guardada (${records.length} registros). Mírala en la pestaña Sesiones.`);
      recordsRef.current = [];
      setRecordCount(0);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(null);
    }
  }

  const sectorCount = ui?.sectorCount || 0;
  const currentSectorIndex = ui ? ui.currentSectors.length : 0;

  return (
    <>
      <section className="rb-card">
        <div className="rb-card-head">
          <h2>Cronometraje en vivo</h2>
          <span className={`rb-pill ${recording ? 'rb-pill-receiving' : 'rb-pill-idle'}`}>
            {recording ? 'grabando' : 'parado'}
          </span>
        </div>

        <div className="rb-kv" style={{ marginBottom: 12 }}>
          <span>Circuito</span>
          <b>{track ? track.name : 'ninguno seleccionado'}</b>
        </div>

        {!track && (
          <p className="rb-alert rb-alert-warn">
            <b>Sin circuito activo.</b> Puedes grabar igualmente (se guardará la sesión, sin
            cronometrar). Para cronometrar, crea el circuito en <b>Circuitos</b>: rueda 2–3 vueltas
            grabando y usa «Crear circuito desde una sesión» (lo más fiable), o marca la meta parado
            sobre la línea.
            {onGoToTracks && (
              <>
                {' '}
                <button type="button" className="rb-btn" style={{ marginLeft: 8 }} onClick={onGoToTracks}>
                  Ir a Circuitos
                </button>
              </>
            )}
          </p>
        )}

        <div className="rb-toolbar">
          <button
            type="button"
            className="rb-btn"
            disabled={recording}
            onClick={() => {
              engineRef.current = new LiveTiming(track);
              lastEventRef.current = null;
              maxSpeedRef.current = 0;
              setMaxSpeed(0);
              setUi(engineRef.current.getSnapshot());
            }}
          >
            Reiniciar cronómetro
          </button>
          <span className="rb-muted" style={{ alignSelf: 'center' }}>
            {connected ? (receiving ? 'enlace BLE activo' : 'conectado, sin recepción') : 'sin conexión'} ·{' '}
            {recordCount} registros
          </span>
        </div>

        {eventFresh && (
          <div className={`rb-alert ${event?.deltaS > 0 ? 'rb-alert-warn' : 'rb-alert-error'}`} style={{ borderColor: 'var(--accent2)' }}>
            {event.type === 'lap' && (
              <>
                <b>Vuelta {ui?.lapNumber ? ui.lapNumber - 1 : ''}:</b> {formatLapTime(event.timeS)}{' '}
                {event.deltaS != null && <>· delta {deltaText(event.deltaS)}</>}
              </>
            )}
            {event.type === 'sector' && (
              <>
                <b>Sector {(event.index || 0) + 1}:</b> {event.timeS?.toFixed(3)} s{' '}
                {event.deltaS != null && <>· delta {deltaText(event.deltaS)}</>}
              </>
            )}
            {event.type === 'start' && <b>Meta cruzada: cronómetro iniciado.</b>}
          </div>
        )}

        {message && <p className="rb-note">{message}</p>}
        {error && <p className="rb-alert rb-alert-error">{error}</p>}
      </section>

      <section className="rb-card rb-dashboard" ref={dashRef}>
        <h2>Tiempos</h2>
        <div className="rb-laptimer">
          <div className="rb-lap-big">
            <span>Vuelta actual</span>
            <b>{formatLapTime(ui?.currentLapElapsedS || 0)}</b>
            <span className="rb-lap-count">
              {ui?.lapNumber ? `Vuelta ${ui.lapNumber}` : 'Cruza la meta para empezar'}
            </span>
            <span className="rb-lap-speed">
              {latest ? `${latest.speed.toFixed(1)} km/h` : '— km/h'}
              <em> · máx {maxSpeed.toFixed(0)}</em>
            </span>
          </div>
          <div className="rb-lap-side">
            <div className="rb-metric">
              <span>Última</span>
              <b>{ui?.lastLapS != null ? formatLapTime(ui.lastLapS) : '—'}</b>
            </div>
            <div className="rb-metric">
              <span>Mejor</span>
              <b>{ui?.bestLapS != null ? formatLapTime(ui.bestLapS) : '—'}</b>
            </div>
            <div className="rb-metric">
              <span>Óptima</span>
              <b>{ui?.optimalLapS != null ? formatLapTime(ui.optimalLapS) : '—'}</b>
            </div>
            <div className="rb-metric">
              <span>Vueltas</span>
              <b>{ui?.laps || 0}</b>
            </div>
          </div>
        </div>
        <span className="rb-muted" data-tick={tick} />
      </section>

      {sectorCount > 0 && (
        <section className="rb-card">
          <h2>Sectores</h2>
          <div className="rb-table-wrap">
            <table className="rb-table">
              <thead>
                <tr>
                  <th>Sector</th>
                  <th>Mejor</th>
                  <th>Última</th>
                  <th>En curso</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: sectorCount }).map((_, i) => (
                  <tr key={i} className={i === currentSectorIndex && recording ? 'rb-row-active' : ''}>
                    <td className="rb-mono">S{i + 1}</td>
                    <td className="rb-mono">{ui?.bestSectors[i] != null ? `${ui.bestSectors[i].toFixed(3)} s` : '—'}</td>
                    <td className="rb-mono">{ui?.lastSectors[i] != null ? `${ui.lastSectors[i].toFixed(3)} s` : '—'}</td>
                    <td className="rb-mono">
                      {i === currentSectorIndex && ui?.currentSectors[i] != null
                        ? `${ui.currentSectors[i].toFixed(3)} s`
                        : i === currentSectorIndex
                          ? '…'
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="rb-actionbar">
        {!recording ? (
          <button type="button" className="rb-btn rb-btn-primary" onClick={start} disabled={!!busy}>
            Iniciar grabación
          </button>
        ) : (
          <button type="button" className="rb-btn rb-btn-danger" onClick={stopAndSave} disabled={!!busy}>
            Detener y guardar
          </button>
        )}
      </div>
    </>
  );
}
