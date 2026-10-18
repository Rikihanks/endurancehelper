import { useEffect, useMemo, useRef, useState } from 'react';
import { SessionStore } from '../../../services/storage/SessionStore.js';
import { TrackStore } from '../../../services/storage/TrackStore.js';
import { exportTextFile } from '../../../services/platform/exportFile.js';
import {
  detectLaps,
  sessionStats,
  computeDeltas,
  resampleLapByDistance,
  downsample,
  formatLapTime,
  toGpx,
  toCsv,
} from '../../../services/devices/racebox/RaceBoxAnalysis.js';
import { buildTimeline, indexAtTime } from '../../../services/devices/racebox/playback.js';
import { smoothPoints, interpolatePolyline } from '../mapGeometry.js';
import {
  computeTrackLaps,
  learnStartFinish,
  trackMatchesSession,
  makeTrap,
} from '../../../services/devices/racebox/RaceBoxTrack.js';
import TrackMap from './TrackMap.jsx';
import LapTable from './LapTable.jsx';
import SectorTable from './SectorTable.jsx';
import TrackEditor from '../tracks/TrackEditor.jsx';
import { SpeedChart, GForceChart, DeltaChart, GgPlot, CompareSpeedChart } from './ChannelCharts.jsx';

const GRID_STEP_M = 5;
const MIN_MOVED_M = 25;

export default function SessionViewer({ sessionId, onClose }) {
  const [session, setSession] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [exportMsg, setExportMsg] = useState(null);
  const [selectedLap, setSelectedLap] = useState(0);
  const [scope, setScope] = useState('lap');
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1);
  const [tNow, setTNow] = useState(0);
  const [smooth, setSmooth] = useState(true);
  const [compare, setCompare] = useState(false);
  const [lapB, setLapB] = useState(0);
  const [sectorMode, setSectorMode] = useState('none');
  const [sectorMsg, setSectorMsg] = useState(null);
  const smoothWindow = 2;
  const [reloadKey, setReloadKey] = useState(0);
  const rafRef = useRef(0);

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

  const timelineA = useMemo(() => {
    if (!analysis || !session) return null;
    return buildTimeline(session.records, analysis.laps, { lapIndex: selectedLap });
  }, [analysis, session, selectedLap]);

  const timelineSession = useMemo(() => {
    if (compare || scope !== 'session' || !analysis || !session) return null;
    return buildTimeline(session.records, analysis.laps, { lapIndex: null });
  }, [compare, scope, analysis, session]);

  const timeline = compare ? timelineA : scope === 'session' ? timelineSession : timelineA;

  // Second lap of the comparison mode.
  const gridB = useMemo(() => {
    if (!compare || !analysis || !session) return null;
    const lap = analysis.laps[lapB];
    if (!lap || !(lap.distanceM > 0)) return null;
    return resampleLapByDistance(session.records, lap, GRID_STEP_M);
  }, [compare, analysis, session, lapB]);

  const timelineB = useMemo(() => {
    if (!compare || !analysis || !session) return null;
    return buildTimeline(session.records, analysis.laps, { lapIndex: lapB });
  }, [compare, analysis, session, lapB]);

  const mapPointsB = useMemo(() => {
    if (!gridB) return [];
    const raw = gridB.distances.map((_, i) => ({ lat: gridB.lat[i], lon: gridB.lon[i], speed: gridB.speeds[i] }));
    return smooth ? smoothPoints(raw, smoothWindow, true) : raw;
  }, [gridB, smooth]);

  const compareDelta = useMemo(() => {
    if (!compare || !analysis || !session || lapB === selectedLap) return [];
    const res = computeDeltas(session.records, analysis.laps, analysis.laps[selectedLap], GRID_STEP_M);
    const entry = res[lapB];
    return entry ? entry.distances.map((d, i) => ({ d, delta: entry.delta[i] })) : [];
  }, [compare, analysis, session, selectedLap, lapB]);

  const toggleCompare = () => {
    setPlaying(false);
    setTNow(0);
    setCompare((prev) => {
      if (!prev && analysis && analysis.laps.length > 1) {
        const alt = analysis.bestIndex !== selectedLap ? analysis.bestIndex : selectedLap === 0 ? 1 : 0;
        setLapB(Math.max(0, Math.min(analysis.laps.length - 1, alt)));
      }
      return !prev;
    });
  };

  // Reset the playhead when the scope changes (not when the lap follows playback).
  useEffect(() => {
    setTNow(0);
  }, [scope]);

  const selectLap = (index) => {
    setSelectedLap(index);
    setTNow(0);
  };

  // While replaying the whole session, the viewer follows the lap being played.
  useEffect(() => {
    if (scope !== 'session' || !timeline) return;
    const idx = indexAtTime(timeline.t, tNow);
    const lap = timeline.lapOf[Math.min(idx, timeline.lapOf.length - 1)];
    if (lap != null && lap !== selectedLap) setSelectedLap(lap);
  }, [tNow, scope, timeline, selectedLap]);

  // Playback loop.
  useEffect(() => {
    if (!playing || !timeline) return undefined;
    let last = performance.now();
    const step = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setTNow((prev) => {
        const next = prev + dt * playSpeed;
        const end = timeline.t[timeline.t.length - 1] || 0;
        if (next >= end) {
          setPlaying(false);
          return end;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, playSpeed, timeline]);

  const markerIdx = timeline ? indexAtTime(timeline.t, tNow) : 0;
  const idxB = timelineB ? indexAtTime(timelineB.t, tNow) : 0;
  const endA = timelineA && timelineA.t.length ? timelineA.t[timelineA.t.length - 1] : 0;
  const endB = timelineB && timelineB.t.length ? timelineB.t[timelineB.t.length - 1] : 0;
  const playbackEnd = compare
    ? Math.max(endA, endB)
    : timeline && timeline.t.length
      ? timeline.t[timeline.t.length - 1]
      : 0;
  const playbackLap =
    timeline && timeline.lapOf.length
      ? timeline.lapOf[Math.min(markerIdx, timeline.lapOf.length - 1)]
      : selectedLap;
  const currentB =
    timelineB && timelineB.t.length
      ? {
          t: timelineB.t[idxB],
          lat: timelineB.lat[idxB],
          lon: timelineB.lon[idxB],
          speed: timelineB.speed[idxB],
          dist: timelineB.dist[idxB],
          lapDist: timelineB.lapDist[idxB],
        }
      : null;

  const mapPoints = useMemo(() => {
    if (!grid) return [];
    const raw = grid.distances.map((_, i) => ({ lat: grid.lat[i], lon: grid.lon[i], speed: grid.speeds[i] }));
    // Positions are smoothed for drawing only (timing never uses this array):
    // at ~22 px/m any GPS noise would look like a zig-zag.
    return smooth ? smoothPoints(raw, smoothWindow, true) : raw;
  }, [grid, smooth]);

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
    const existing = analysis && analysis.matchedTrack;
    if (existing) {
      if (
        !window.confirm(
          `Ya hay un circuito asociado («${existing.name}»). ¿Actualizar su meta y su trazada con esta sesión? (los sectores se conservan)`,
        )
      ) {
        return;
      }
      await TrackStore.save({
        ...existing,
        edited: true,
        startFinish: trap,
        centerline: sessionTrace() || existing.centerline,
      });
      setExportMsg(`Circuito «${existing.name}» actualizado con esta sesión (meta y trazada).`);
      setReloadKey((k) => k + 1);
      return;
    }
    const name = window.prompt('Nombre del circuito', `Circuito ${new Date().toISOString().slice(0, 10)}`);
    if (name === null) return;
    await TrackStore.save({
      name: name || 'Circuito',
      startFinish: trap,
      splits: [],
      centerline: sessionTrace(),
    });
    setReloadKey((k) => k + 1);
  }

  /** Trace of the best lap (smoothed, closed) or of the whole session as fallback. */
  function sessionTrace() {
    if (!session || !analysis) return null;
    const lap = analysis.laps[analysis.bestIndex];
    let points = null;
    if (lap && lap.endIndex > lap.startIndex) {
      const g = resampleLapByDistance(session.records, lap, GRID_STEP_M);
      points = g.distances.map((_, i) => ({ lat: g.lat[i], lon: g.lon[i] }));
    } else {
      points = downsample(session.records, 400).map((r) => ({ lat: r.latitude, lon: r.longitude }));
    }
    if (!points || points.length < 4) return null;
    return smoothPoints(points, 2, true);
  }

  async function updateTrackTrace() {
    try {
      setExportMsg(null);
      const track = await ensureTrackForSession();
      const trace = sessionTrace();
      if (!trace) {
        setExportMsg('No hay trazada suficiente en esta sesión.');
        return;
      }
      await TrackStore.save({ ...track, edited: true, centerline: trace });
      setExportMsg(
        `Trazada de «${track.name}» actualizada con la vuelta ${analysis.bestIndex + 1} de esta sesión (${trace.length} puntos).`,
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      setExportMsg(`No se pudo actualizar la trazada: ${String((err && err.message) || err)}`);
    }
  }

  async function ensureTrackForSession() {
    const existing = analysis && analysis.matchedTrack;
    if (existing) return existing;
    const trap = learnStartFinish(session.records || []);
    if (!trap) throw new Error('No se pudo deducir la meta en esta sesión (¿hubo movimiento?).');
    const id = await TrackStore.save({
      name: session.meta.name ? `Circuito · ${session.meta.name}` : 'Circuito',
      startFinish: trap,
      splits: [],
      centerline: mapPoints.map((p) => ({ lat: p.lat, lon: p.lon })),
    });
    return TrackStore.get(id);
  }

  async function pickSector(point) {
    if (sectorMode === 'none') {
      setSectorMsg('Elige primero «Colocar meta» o «Añadir sector» y toca la línea del mapa.');
      return;
    }
    try {
      setSectorMsg(null);
      const track = await ensureTrackForSession();
      if (sectorMode === 'startFinish') {
        await TrackStore.save({
          ...track,
          edited: true,
          startFinish: makeTrap({
            lat: point.lat,
            lon: point.lon,
            heading: point.heading,
            width: track.startFinish ? track.startFinish.width : 20,
            type: 'startFinish',
            name: 'Meta',
          }),
        });
        setSectorMsg('Meta actualizada: las vueltas se recalculan con la nueva línea.');
      } else {
        const splits = [...(track.splits || [])];
        if (splits.length >= 4) {
          setSectorMsg('Máximo 4 sectores (como la app oficial): quita alguno para añadir otro.');
          return;
        }
        splits.push(
          makeTrap({
            lat: point.lat,
            lon: point.lon,
            heading: point.heading,
            width: 30,
            type: 'split',
            name: `Sector ${splits.length + 1}`,
          }),
        );
        await TrackStore.save({ ...track, edited: true, splits });
        setSectorMsg(`Sector ${splits.length} añadido: tiempos recalculados.`);
      }
      setSectorMode('none');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setSectorMsg(`No se pudo guardar: ${String((err && err.message) || err)}`);
    }
  }

  async function removeLastSector() {
    try {
      const track = analysis && analysis.matchedTrack;
      if (!track || !(track.splits || []).length) {
        setSectorMsg('No hay sectores que quitar.');
        return;
      }
      await TrackStore.save({ ...track, edited: true, splits: track.splits.slice(0, -1) });
      setSectorMsg('Último sector eliminado.');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setSectorMsg(`No se pudo quitar: ${String((err && err.message) || err)}`);
    }
  }

  async function doExport(kind) {
    if (!session) return;
    setExportMsg(null);
    try {
      const name = session.meta.name || 'sesion-racebox';
      const text = kind === 'gpx' ? toGpx(session.records, { name }) : toCsv(session.records);
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
  const startedAt = session.meta.startedAt ? new Date(session.meta.startedAt) : null;
  const current =
    timeline && timeline.t.length
      ? {
          t: timeline.t[markerIdx],
          lat: timeline.lat[markerIdx],
          lon: timeline.lon[markerIdx],
          speed: timeline.speed[markerIdx],
          gLat: timeline.gLat[markerIdx],
          gLong: timeline.gLong[markerIdx],
          dist: timeline.dist[markerIdx],
          lapDist: timeline.lapDist ? timeline.lapDist[markerIdx] : undefined,
        }
      : null;

  // The marker runs along the drawn (smoothed) line using the real distance
  // travelled, so it never shows the GPS jitter. Declared after mapPoints.
  const markerOnLine = (points, lapDist) => {
    if (!points || points.length < 2) return null;
    const d = Number(lapDist);
    if (!Number.isFinite(d)) return null;
    return interpolatePolyline(points, d / GRID_STEP_M);
  };
  const markerA = markerOnLine(mapPoints, current && current.lapDist);
  const markerB = markerOnLine(mapPointsB, currentB && currentB.lapDist);

  // Gates (start/finish + sectors) drawn on the trace.
  const viewerTraps = analysis.matchedTrack
    ? [analysis.matchedTrack.startFinish, ...(analysis.matchedTrack.splits || [])].filter(Boolean)
    : [];

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
            {analysis.matchedTrack ? 'Ajustar circuito' : 'Guardar circuito'}
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
            <b>Esta sesión no tiene movimiento.</b> El vehículo estuvo prácticamente parado (
            {Number(stats.distanceM || 0).toFixed(1)} m recorridos), así que no hay trazada ni vueltas
            que analizar: no es un fallo de la app, simplemente no hay datos de conducción. Graba
            rodando en el circuito y podrás ver la trazada por velocidad, las gráficas y los tiempos.
          </div>
        </section>
      )}

      {moved && hasTrace && (
        <>
          <section className="rb-card">
            <div className="rb-card-head">
              <h2>Trazada</h2>
              <span className="rb-muted">
                {scope === 'session'
                  ? `Sesión completa · vuelta ${(playbackLap || 0) + 1}`
                  : `Vuelta ${selectedLap + 1}${selectedLap === bestIndex ? ' (mejor)' : ''}`}
              </span>
            </div>

            {compare ? (
              <div className="rb-compare">
                <div className="rb-compare-col">
                  <div className="rb-compare-head">
                    <span>
                      A · Vuelta {selectedLap + 1}
                      {selectedLap === bestIndex ? ' (mejor)' : ''}
                    </span>
                    <b>{formatLapTime(laps[selectedLap] && laps[selectedLap].durationS)}</b>
                  </div>
                  <TrackMap
                    points={mapPoints}
                    traps={viewerTraps}
                    marker={markerA}
                  />
                  <div className="rb-playback-readout">
                    <span>{Number((current && current.dist) || 0).toFixed(0)} m</span>
                    <span>{Number((current && current.speed) || 0).toFixed(1)} km/h</span>
                  </div>
                </div>
                <div className="rb-compare-col">
                  <div className="rb-compare-head">
                    <span>
                      B · Vuelta {lapB + 1}
                      {lapB === bestIndex ? ' (mejor)' : ''}
                    </span>
                    <b>{formatLapTime(laps[lapB] && laps[lapB].durationS)}</b>
                  </div>
                  <TrackMap
                    points={mapPointsB}
                    traps={viewerTraps}
                    marker={markerB}
                  />
                  <div className="rb-playback-readout">
                    <span>{Number((currentB && currentB.dist) || 0).toFixed(0)} m</span>
                    <span>{Number((currentB && currentB.speed) || 0).toFixed(1)} km/h</span>
                  </div>
                </div>
              </div>
            ) : (
              <TrackMap points={mapPoints} traps={viewerTraps} marker={markerA} />
            )}

            {compare && (
              <div className="rb-toolbar" style={{ marginTop: 10 }}>
                <label className="rb-field">
                  <span className="rb-field-label">Vuelta B (la A es la seleccionada)</span>
                  <select
                    value={lapB}
                    onChange={(e) => {
                      setLapB(Number(e.target.value));
                      setTNow(0);
                      setPlaying(false);
                    }}
                  >
                    {laps.map((l, i) => (
                      <option key={i} value={i}>
                        {`Vuelta ${i + 1} · ${formatLapTime(l.durationS)}`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rb-kv">
                  <span>A la misma t</span>
                  <b>
                    {Number((current && current.dist) || 0) - Number((currentB && currentB.dist) || 0) >= 0
                      ? '+'
                      : '−'}
                    {Math.abs(
                      Number((current && current.dist) || 0) - Number((currentB && currentB.dist) || 0),
                    ).toFixed(1)}{' '}
                    m
                  </b>
                </div>
              </div>
            )}

            <div className={compare ? 'rb-transport rb-transport-single' : 'rb-transport'}>
              {!compare && (
                <button
                  type="button"
                  className="rb-btn rb-btn-icon"
                  aria-label="Vuelta anterior"
                  disabled={scope === 'session' || selectedLap <= 0}
                  onClick={() => {
                    setScope('lap');
                    selectLap(Math.max(0, selectedLap - 1));
                  }}
                >
                  ⏮
                </button>
              )}
              <button
                type="button"
                className="rb-btn rb-btn-primary rb-btn-play"
                aria-label={playing ? 'Pausa' : 'Reproducir'}
                onClick={() => {
                  if (!playing && tNow >= (playbackEnd || 0)) setTNow(0);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              {!compare && (
                <button
                  type="button"
                  className="rb-btn rb-btn-icon"
                  aria-label="Vuelta siguiente"
                  disabled={scope === 'session' || selectedLap >= laps.length - 1}
                  onClick={() => {
                    setScope('lap');
                    selectLap(Math.min(laps.length - 1, selectedLap + 1));
                  }}
                >
                  ⏭
                </button>
              )}
            </div>

            <div className="rb-transport-secondary">
              {!compare && (
                <div className="rb-seg" role="group" aria-label="Qué reproducir">
                  <button
                    type="button"
                    className={scope === 'lap' ? 'active' : ''}
                    onClick={() => setScope('lap')}
                  >
                    Vuelta
                  </button>
                  <button
                    type="button"
                    className={scope === 'session' ? 'active' : ''}
                    onClick={() => setScope('session')}
                  >
                    Sesión completa
                  </button>
                </div>
              )}
              {laps.length > 1 && (
                <div className="rb-seg" role="group" aria-label="Comparación">
                  <button type="button" className={!compare ? 'active' : ''} onClick={() => compare && toggleCompare()}>
                    1 vuelta
                  </button>
                  <button type="button" className={compare ? 'active' : ''} onClick={() => !compare && toggleCompare()}>
                    Comparar 2
                  </button>
                </div>
              )}
              <div className="rb-seg" role="group" aria-label="Velocidad de reproducción">
                {[1, 2, 4].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={playSpeed === s ? 'active' : ''}
                    onClick={() => setPlaySpeed(s)}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <div className="rb-seg" role="group" aria-label="Trazada">
                <button type="button" className={smooth ? 'active' : ''} onClick={() => setSmooth(true)}>
                  Suave
                </button>
                <button type="button" className={!smooth ? 'active' : ''} onClick={() => setSmooth(false)}>
                  Real
                </button>
              </div>
            </div>

            <div className="rb-playback">
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.round(playbackEnd * 10))}
                value={Math.round((tNow || 0) * 10)}
                onChange={(e) => {
                  setPlaying(false);
                  setTNow(Number(e.target.value) / 10);
                }}
                aria-label="Posición en la reproducción"
              />
              <div className="rb-playback-readout">
                <span>{Number(current?.dist || 0).toFixed(0)} m</span>
                <span>{Number(current?.speed || 0).toFixed(1)} km/h</span>
                <span>lat {Number(current?.gLat || 0).toFixed(2)} g</span>
                <span>lon {Number(current?.gLong || 0).toFixed(2)} g</span>
                <span>t {Number(current?.t || 0).toFixed(2)} s</span>
              </div>
            </div>
          </section>

          <section className="rb-card">
            <h2>
              {compare
                ? `Comparación · vuelta ${selectedLap + 1} vs ${lapB + 1}`
                : `Canales · vuelta ${selectedLap + 1}`}
            </h2>
            {compare ? (
              <>
                <h3>Velocidad (por distancia)</h3>
                <CompareSpeedChart
                  gridA={grid}
                  gridB={gridB}
                  labelA={`V${selectedLap + 1}`}
                  labelB={`V${lapB + 1}`}
                />
                <h3>Delta de la vuelta {lapB + 1} respecto a la {selectedLap + 1}</h3>
                <DeltaChart data={compareDelta} />
              </>
            ) : (
              <>
                <h3>Velocidad</h3>
                <SpeedChart grid={grid} />
                <h3>Aceleraciones (g)</h3>
                <GForceChart grid={grid} />
                <h3>Delta vs mejor vuelta</h3>
                <DeltaChart data={deltaData} />
                <h3>G-G</h3>
                <GgPlot points={ggPoints} />
              </>
            )}
          </section>
        </>
      )}

      <section className="rb-card">
        <div className="rb-card-head">
          <h2>Vueltas</h2>
          {laps.length > 1 && (
            <div className="rb-lapnav">
              <button
                type="button"
                className="rb-btn"
                disabled={selectedLap <= 0}
                onClick={() => selectLap(Math.max(0, selectedLap - 1))}
              >
                ← Anterior
              </button>
              <button
                type="button"
                className="rb-btn"
                disabled={selectedLap >= laps.length - 1}
                onClick={() => selectLap(Math.min(laps.length - 1, selectedLap + 1))}
              >
                Siguiente →
              </button>
            </div>
          )}
        </div>
        <LapTable laps={laps} bestIndex={bestIndex} selectedIndex={selectedLap} onSelect={selectLap} />
        {lap && (
          <p className="rb-muted" style={{ marginTop: 10 }}>
            Vuelta seleccionada: {formatLapTime(lap.durationS)} · {Number(lap.distanceM || 0).toFixed(0)} m ·
            vel. media {Number(lap.avgSpeed || 0).toFixed(1)} km/h
          </p>
        )}
      </section>

      {moved && hasTrace && (
        <section className="rb-card">
          <div className="rb-card-head">
            <h2>Sectores y meta</h2>
            <span className="rb-muted">
              {analysis.matchedTrack
                ? `${(analysis.matchedTrack.splits || []).length} sectores · «${analysis.matchedTrack.name}»`
                : 'se creará un circuito con esta sesión'}
            </span>
          </div>

          <SectorTable laps={laps} bestIndex={bestIndex} />

          <div className="rb-toolbar" style={{ marginTop: 10 }}>
            <button
              type="button"
              className={sectorMode === 'startFinish' ? 'rb-btn rb-btn-primary' : 'rb-btn'}
              onClick={() => setSectorMode(sectorMode === 'startFinish' ? 'none' : 'startFinish')}
            >
              Colocar meta
            </button>
            <button
              type="button"
              className={sectorMode === 'split' ? 'rb-btn rb-btn-primary' : 'rb-btn'}
              onClick={() => setSectorMode(sectorMode === 'split' ? 'none' : 'split')}
            >
              Añadir sector
            </button>
            <button
              type="button"
              className="rb-btn"
              onClick={removeLastSector}
              disabled={!(analysis.matchedTrack && (analysis.matchedTrack.splits || []).length)}
            >
              Quitar último
            </button>
            <button type="button" className="rb-btn" onClick={updateTrackTrace}>
              Usar esta vuelta como trazada
            </button>
          </div>

          {sectorMsg && <p className="rb-note">{sectorMsg}</p>}
          {sectorMode !== 'none' && (
            <p className="rb-note">
              Toca sobre la <b>línea azul</b> (el trazado de esta vuelta) para colocar{' '}
              {sectorMode === 'startFinish' ? 'la meta' : 'el sector'}. El sentido se toma de la
              trazada, no del GPS parado.
            </p>
          )}

          <TrackEditor
            points={mapPoints}
            traps={[
              analysis.matchedTrack && analysis.matchedTrack.startFinish,
              ...((analysis.matchedTrack && analysis.matchedTrack.splits) || []),
            ].filter(Boolean)}
            onPick={pickSector}
          />

          <p className="rb-hint">
            Los cambios se guardan en el circuito, así que también valen para sesiones futuras (y
            puedes afinarlos en la pestaña Circuitos). Colocar 1–4 sectores divide cada vuelta en
            tramos y los tiempos se recalculan al instante. «Usar esta vuelta como trazada» sustituye
            el dibujo del circuito por tu línea real (la mejor vuelta de esta sesión), conservando la
            meta y los sectores.
          </p>
        </section>
      )}
    </>
  );
}
