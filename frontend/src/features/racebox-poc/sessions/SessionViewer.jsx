import { useEffect, useMemo, useState } from 'react';
import { SessionStore } from '../../../services/storage/SessionStore.js';
import { TrackStore } from '../../../services/storage/TrackStore.js';
import { exportTextFile } from '../../../services/platform/exportFile.js';
import {
  detectLaps,
  sessionStats,
  computeDeltas,
  resampleLapByDistance,
  formatLapTime,
  toGpx,
  toCsv,
} from '../../../services/devices/racebox/RaceBoxAnalysis.js';
import {
  computeTrackLaps,
  learnStartFinish,
  trackMatchesSession,
} from '../../../services/devices/racebox/RaceBoxTrack.js';
import TrackMap from './TrackMap.jsx';
import LapTable from './LapTable.jsx';
import { SpeedChart, GForceChart, DeltaChart, GgPlot } from './ChannelCharts.jsx';

const GRID_STEP_M = 5;
const MIN_MOVED_M = 25;

export default function SessionViewer({ sessionId, onClose }) {
  const [session, setSession] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [exportMsg, setExportMsg] = useState(null);
  const [selectedLap, setSelectedLap] = useState(0);
  const [marker, setMarker] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  // Opening a session on a phone must not keep the previous scroll position.
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (_) {
      /* ignore */
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setAnalysis(null);
    setError(null);
    setExportMsg(null);
    if (!sessionId) {
      setError('No se pudo identificar la sesión (falta el id). Vuelve a la lista y ábrela de nuevo.');
      return undefined;
    }
    SessionStore.get(sessionId)
      .then((s) => {
        if (cancelled) return;
        if (!s) {
          setError('Sesión no encontrada.');
          return;
        }
        if (!Array.isArray(s.records) || s.records.length === 0) {
          setError('Esta sesión no tiene registros guardados (se grabó sin datos). Bórrala y graba de nuevo.');
          return;
        }
        setSession(s);
      })
      .catch((err) => {
        if (!cancelled) setError(String((err && err.message) || err));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Analysis is heavy on long sessions; run it after paint. If a saved track
  // matches this session we time the laps from its traps (deterministic);
  // otherwise we fall back to the heuristic and offer to learn the track.
  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const records = session.records || [];
      try {
        let laps = null;
        let optimalLapS = null;
        let timing = 'heurística';
        let matchedTrack = null;
        try {
          const tracks = await TrackStore.list();
          matchedTrack = tracks.find((t) => trackMatchesSession(t, records)) || null;
        } catch (_) {
          matchedTrack = null;
        }
        if (matchedTrack) {
          const res = computeTrackLaps(records, matchedTrack);
          if (res.laps.length) {
            laps = res.laps;
            optimalLapS = res.optimalLapS;
            timing = `circuito «${matchedTrack.name}»`;
          }
        }
        if (!laps) laps = detectLaps(records);

        const stats = sessionStats(records, laps);
        let bestIndex = 0;
        laps.forEach((l, i) => {
          if (l.durationS < laps[bestIndex].durationS) bestIndex = i;
        });
        const deltas = laps.length ? computeDeltas(records, laps, laps[bestIndex], GRID_STEP_M) : [];
        if (!cancelled) {
          setAnalysis({ laps, stats, bestIndex, deltas, optimalLapS, timing, matchedTrack });
          setSelectedLap(bestIndex);
        }
      } catch (err) {
        if (!cancelled) setError(String((err && err.message) || err));
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [session, reloadKey]);

  const grid = useMemo(() => {
    if (!analysis || !session) return null;
    const lap = analysis.laps[selectedLap];
    if (!lap || !(lap.distanceM > 0)) return null;
    return resampleLapByDistance(session.records, lap, GRID_STEP_M);
  }, [analysis, session, selectedLap]);

  useEffect(() => {
    setMarker(0);
  }, [selectedLap]);

  const mapPoints = useMemo(() => {
    if (!grid) return [];
    return grid.distances.map((_, i) => ({ lat: grid.lat[i], lon: grid.lon[i], speed: grid.speeds[i] }));
  }, [grid]);

  const ggPoints = useMemo(() => {
    if (!grid) return [];
    return grid.distances.map((_, i) => ({ lat: grid.gLat[i] / 1000, lon: grid.gLong[i] / 1000 }));
  }, [grid]);

  const deltaData = useMemo(() => {
    if (!analysis) return [];
    const entry = analysis.deltas[selectedLap];
    if (!entry) return [];
    return entry.distances.map((d, i) => ({ d, delta: entry.delta[i] }));
  }, [analysis, selectedLap]);

  async function learnTrack() {
    if (!session) return;
    const trap = learnStartFinish(session.records || []);
    if (!trap) {
      setError('No se pudo deducir una línea de meta para esta sesión (¿hubo movimiento?).');
      return;
    }
    const name = window.prompt('Nombre del circuito', `Circuito ${new Date().toISOString().slice(0, 10)}`);
    if (name === null) return;
    await TrackStore.save({ name: name || 'Circuito', startFinish: trap, splits: [] });
    setReloadKey((k) => k + 1);
  }

  async function doExport(kind) {
    if (!session) return;
    setExportMsg(null);
    try {
      const name = session.meta.name || 'sesion-racebox';
      const text =
        kind === 'gpx'
          ? toGpx(session.records, { name })
          : toCsv(session.records);
      const res = await exportTextFile(
        `${name}.${kind}`,
        text,
        kind === 'gpx' ? 'application/gpx+xml' : 'text/csv',
      );
      setExportMsg(
        res.via === 'share'
          ? `Archivo listo: ${res.filename}. Se abrió el menú para guardarlo o compartirlo.`
          : `Descargando ${res.filename}…`,
      );
    } catch (err) {
      setExportMsg(`No se pudo exportar: ${String((err && err.message) || err)}`);
    }
  }

  if (error) {
    return (
      <section className="rb-card">
        <button type="button" className="rb-btn" onClick={onClose}>
          ← Volver a sesiones
        </button>
        <p className="rb-alert rb-alert-error" style={{ marginTop: 16 }}>
          {error}
        </p>
      </section>
    );
  }

  if (!session || !analysis) {
    return (
      <section className="rb-card">
        <button type="button" className="rb-btn" onClick={onClose}>
          ← Volver a sesiones
        </button>
        <p className="rb-muted" style={{ marginTop: 12 }}>
          Cargando y analizando la sesión… (las sesiones largas tardan unos segundos)
        </p>
      </section>
    );
  }

  const { stats, laps, bestIndex } = analysis;
  const hasTrace = !!(grid && grid.distances.length > 1);
  const moved = (stats.distanceM || 0) >= MIN_MOVED_M;
  const lap = laps[selectedLap];
  const idx = hasTrace ? Math.min(marker, grid.distances.length - 1) : 0;
  const startedAt = session.meta.startedAt ? new Date(session.meta.startedAt) : null;

  return (
    <>
      <section className="rb-card">
        <div className="rb-card-head">
          <div>
            <button type="button" className="rb-btn" onClick={onClose}>
              ← Sesiones
            </button>
            <h2 style={{ marginTop: 12 }}>{session.meta.name}</h2>
            <p className="rb-muted">
              {startedAt && !Number.isNaN(startedAt.getTime())
                ? `${startedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`
                : 'fecha desconocida'}{' '}
              · {stats.recordCount} registros · {formatLapTime(stats.durationS)} ·{' '}
              {(Number(stats.distanceM || 0) / 1000).toFixed(2)} km
            </p>
          </div>
        </div>

        <div className="rb-toolbar">
          <button type="button" className="rb-btn" onClick={() => doExport('gpx')}>
            Exportar GPX
          </button>
          <button type="button" className="rb-btn" onClick={() => doExport('csv')}>
            Exportar CSV
          </button>
          <button type="button" className="rb-btn rb-btn-primary" onClick={learnTrack}>
            Guardar circuito
          </button>
        </div>
        {exportMsg && <p className="rb-note">{exportMsg}</p>}
      </section>

      <section className="rb-card">
        <h2>Resumen</h2>
        <div className="rb-metrics">
          <div className="rb-metric">
            <span>Vueltas</span>
            <b>{stats.lapCount || '—'}</b>
          </div>
          <div className="rb-metric">
            <span>Mejor vuelta</span>
            <b>{stats.bestLap ? formatLapTime(stats.bestLap.durationS) : '—'}</b>
          </div>
          <div className="rb-metric">
            <span>Vuelta óptima</span>
            <b>{analysis.optimalLapS ? formatLapTime(analysis.optimalLapS) : '—'}</b>
          </div>
          <div className="rb-metric">
            <span>Vel. máx</span>
            <b>{Number(stats.maxSpeed || 0).toFixed(0)} km/h</b>
          </div>
          <div className="rb-metric">
            <span>G máx</span>
            <b>{(Number(stats.maxG || 0) / 1000).toFixed(2)} g</b>
          </div>
          <div className="rb-metric">
            <span>Distancia</span>
            <b>{(Number(stats.distanceM || 0) / 1000).toFixed(2)} km</b>
          </div>
        </div>
        <p className="rb-note">
          Cronometraje por <b>{analysis.timing}</b>.{' '}
          {analysis.matchedTrack
            ? 'Las vueltas se calculan cruzando la línea de meta del circuito (trap con rumbo y ancho).'
            : 'No hay circuito guardado para esta sesión: se usa la detección por cruce más cerrado. Pulsa «Guardar circuito» para fijar la meta.'}
        </p>
      </section>

      {!moved && (
        <section className="rb-card">
          <div className="rb-alert rb-alert-warn">
            <b>Esta sesión no tiene movimiento.</b> El vehículo estuvo prácticamente parado
            ({(stats.distanceM || 0).toFixed(1)} m recorridos), así que no hay trazada ni vueltas que
            analizar: no es un fallo de la app, simplemente no hay datos de conducción. Graba rodando
            en el circuito y podrás ver la trazada por velocidad, las gráficas y los tiempos.
          </div>
        </section>
      )}

      {moved && hasTrace && (
        <>
          <section className="rb-card">
            <div className="rb-card-head">
              <h2>Trazada</h2>
              <span className="rb-muted">
                Vuelta {selectedLap + 1}
                {selectedLap === bestIndex ? ' (mejor)' : ''}
              </span>
            </div>
            <TrackMap points={mapPoints} markerIndex={idx} />
            <div className="rb-playback">
              <input
                type="range"
                min={0}
                max={Math.max(0, grid.distances.length - 1)}
                value={idx}
                onChange={(e) => setMarker(Number(e.target.value))}
                aria-label="Posición en la vuelta"
              />
              <div className="rb-playback-readout">
                <span>{grid.distances[idx]?.toFixed(0)} m</span>
                <span>{grid.speeds[idx]?.toFixed(1)} km/h</span>
                <span>lat {(grid.gLat[idx] / 1000).toFixed(2)} g</span>
                <span>lon {(grid.gLong[idx] / 1000).toFixed(2)} g</span>
                <span>t {(grid.times[idx] || 0).toFixed(2)} s</span>
              </div>
            </div>
          </section>

          <section className="rb-card">
            <h2>Canales · vuelta {selectedLap + 1}</h2>
            <h3>Velocidad</h3>
            <SpeedChart grid={grid} />
            <h3>Aceleraciones (g)</h3>
            <GForceChart grid={grid} />
            <h3>Delta vs mejor vuelta</h3>
            <DeltaChart data={deltaData} />
            <h3>G-G</h3>
            <GgPlot points={ggPoints} />
          </section>
        </>
      )}

      <section className="rb-card">
        <h2>Vueltas</h2>
        <LapTable laps={laps} bestIndex={bestIndex} selectedIndex={selectedLap} onSelect={setSelectedLap} />
        {lap && (
          <p className="rb-muted" style={{ marginTop: 10 }}>
            Vuelta seleccionada: {formatLapTime(lap.durationS)} · {Number(lap.distanceM || 0).toFixed(0)} m ·
            vel. media {Number(lap.avgSpeed || 0).toFixed(1)} km/h
          </p>
        )}
      </section>
    </>
  );
}
