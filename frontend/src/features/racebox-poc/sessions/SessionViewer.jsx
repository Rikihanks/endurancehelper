import { useEffect, useMemo, useState } from 'react';
import { SessionStore } from '../../../services/storage/SessionStore.js';
import {
  detectLaps,
  sessionStats,
  computeDeltas,
  resampleLapByDistance,
  formatLapTime,
  toGpx,
  toCsv,
} from '../../../services/devices/racebox/RaceBoxAnalysis.js';
import TrackMap from './TrackMap.jsx';
import LapTable from './LapTable.jsx';
import { SpeedChart, GForceChart, DeltaChart, GgPlot } from './ChannelCharts.jsx';

const GRID_STEP_M = 5;

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SessionViewer({ sessionId, onClose }) {
  const [session, setSession] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [selectedLap, setSelectedLap] = useState(0);
  const [marker, setMarker] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setAnalysis(null);
    setError(null);
    SessionStore.get(sessionId)
      .then((s) => {
        if (cancelled) return;
        if (!s) {
          setError('Sesión no encontrada.');
          return;
        }
        setSession(s);
      })
      .catch((err) => !cancelled && setError(String(err.message || err)));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Analysis is heavy on long sessions; run it after paint.
  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    const handle = setTimeout(() => {
      try {
        const records = session.records;
        const laps = detectLaps(records);
        const stats = sessionStats(records, laps);
        let bestIndex = 0;
        laps.forEach((l, i) => {
          if (l.durationS < laps[bestIndex].durationS) bestIndex = i;
        });
        const deltas = laps.length ? computeDeltas(records, laps, laps[bestIndex], GRID_STEP_M) : [];
        if (!cancelled) {
          setAnalysis({ laps, stats, bestIndex, deltas });
          setSelectedLap(bestIndex);
        }
      } catch (err) {
        if (!cancelled) setError(String(err.message || err));
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [session]);

  const grid = useMemo(() => {
    if (!analysis || !session) return null;
    const lap = analysis.laps[selectedLap];
    if (!lap) return null;
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

  if (error) {
    return (
      <section className="rb-card">
        <button type="button" className="rb-btn" onClick={onClose}>
          Volver a sesiones
        </button>
        <p className="rb-alert rb-alert-error" style={{ marginTop: 16 }}>
          {error}
        </p>
      </section>
    );
  }

  if (!session || !analysis || !grid) {
    return (
      <section className="rb-card">
        <p className="rb-muted">Cargando y analizando la sesión… (las sesiones largas tardan unos segundos)</p>
      </section>
    );
  }

  const { stats, laps, bestIndex } = analysis;
  const lap = laps[selectedLap];
  const idx = Math.min(marker, grid.distances.length - 1);
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
              {startedAt ? startedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'fecha desconocida'} ·{' '}
              {stats.recordCount} registros · {formatLapTime(stats.durationS)} ·{' '}
              {(stats.distanceM / 1000).toFixed(2)} km
            </p>
          </div>
          <div className="rb-toolbar">
            <button
              type="button"
              className="rb-btn"
              onClick={() => download(`${session.meta.name}.gpx`, toGpx(session.records, { name: session.meta.name }), 'application/gpx+xml')}
            >
              Exportar GPX
            </button>
            <button
              type="button"
              className="rb-btn"
              onClick={() => download(`${session.meta.name}.csv`, toCsv(session.records), 'text/csv')}
            >
              Exportar CSV
            </button>
          </div>
        </div>

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
            <span>Vel. máx</span>
            <b>{stats.maxSpeed.toFixed(0)} km/h</b>
          </div>
          <div className="rb-metric">
            <span>G máx</span>
            <b>{(stats.maxG / 1000).toFixed(2)} g</b>
          </div>
          <div className="rb-metric">
            <span>Distancia</span>
            <b>{(stats.distanceM / 1000).toFixed(2)} km</b>
          </div>
          <div className="rb-metric">
            <span>Duración</span>
            <b>{formatLapTime(stats.durationS)}</b>
          </div>
        </div>
      </section>

      <section className="rb-card">
        <div className="rb-card-head">
          <h2>Trazada</h2>
          <span className="rb-muted">Vuelta {selectedLap + 1}{selectedLap === bestIndex ? ' (mejor)' : ''}</span>
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

      <section className="rb-card">
        <h2>Vueltas</h2>
        <LapTable
          laps={laps}
          bestIndex={bestIndex}
          selectedIndex={selectedLap}
          onSelect={setSelectedLap}
        />
        {lap && (
          <p className="rb-muted" style={{ marginTop: 10 }}>
            Vuelta seleccionada: {formatLapTime(lap.durationS)} · {lap.distanceM.toFixed(0)} m · vel. media{' '}
            {lap.avgSpeed.toFixed(1)} km/h
          </p>
        )}
      </section>
    </>
  );
}
