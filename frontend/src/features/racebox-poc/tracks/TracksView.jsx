import { useCallback, useEffect, useState } from 'react';
import { TrackStore } from '../../../services/storage/TrackStore.js';
import { SessionStore } from '../../../services/storage/SessionStore.js';
import { makeTrap, learnStartFinish } from '../../../services/devices/racebox/RaceBoxTrack.js';
import { downsample } from '../../../services/devices/racebox/RaceBoxAnalysis.js';
import { parseTrackFile, parseCoordinateList, downsamplePoints } from '../../../utils/trackFiles.js';
import { BUILTIN_TRACKS } from '../../../data/builtinTracks.js';
import TrackEditor from './TrackEditor.jsx';

// Track library and editor: create a track from the current position (stand on
// the start/finish line) or learn one from a recorded session, add splits,
// rename/delete and pick the active track. This is what makes lap timing
// possible at a circuit that is not in any database (like a local karting).

function fmtCoord(v) {
  return Number(v).toFixed(6);
}

/** Downsampled GPS trace of a session, used as a track centerline for editing. */
function sessionCenterline(records, max = 400) {
  if (!records || records.length < 2) return null;
  return downsample(records, max).map((r) => ({ lat: r.latitude, lon: r.longitude }));
}

export default function TracksView({ adapter, snapshot, activeTrackId, onSelectTrack }) {
  const [tracks, setTracks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [name, setName] = useState('');
  const [placement, setPlacement] = useState('none');
  const [centerSessionId, setCenterSessionId] = useState('');
  const [pasted, setPasted] = useState('');

  const connected = !!snapshot.connectedDeviceId;
  const latest = snapshot.latest;

  const refresh = useCallback(async () => {
    try {
      await TrackStore.ensureBuiltins(BUILTIN_TRACKS);
      const [t, s] = await Promise.all([TrackStore.list(), SessionStore.list().catch(() => [])]);
      setTracks(t);
      setSessions(s);
    } catch (err) {
      setError(String(err.message || err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(label, fn) {
    if (busy) return;
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(null);
    }
  }

  const activeTrack = tracks.find((t) => t.id === activeTrackId) || null;

  const createFromCurrent = () =>
    run('createCurrent', async () => {
      if (!latest) {
        throw new Error('No hay posición en vivo. Conéctate y pulsa «Iniciar recepción» con el kart sobre la línea de meta.');
      }
      const trackName = name.trim() || `Circuito ${new Date().toISOString().slice(0, 10)}`;
      const id = await TrackStore.save({
        name: trackName,
        startFinish: makeTrap({
          lat: latest.latitude,
          lon: latest.longitude,
          heading: latest.heading || 0,
          width: 50,
          type: 'startFinish',
          name: 'Meta',
        }),
        splits: [],
      });
      setName('');
      await refresh();
      onSelectTrack(id);
      setMessage(`Circuito «${trackName}» guardado y activado. Meta en ${fmtCoord(latest.latitude)}, ${fmtCoord(latest.longitude)}.`);
    });

  const addSplitCurrent = () =>
    run('addSplit', async () => {
      if (!activeTrack) throw new Error('Selecciona un circuito activo primero.');
      if (!latest) throw new Error('No hay posición en vivo para marcar el split.');
      const split = makeTrap({
        lat: latest.latitude,
        lon: latest.longitude,
        heading: latest.heading || 0,
        width: 40,
        type: 'split',
        name: `Split ${(activeTrack.splits || []).length + 1}`,
      });
      await TrackStore.save({ ...activeTrack, splits: [...(activeTrack.splits || []), split] });
      await refresh();
      setMessage(`Split añadido en ${fmtCoord(latest.latitude)}, ${fmtCoord(latest.longitude)}.`);
    });

  const learnFromSession = (sessionId) =>
    run(`learn:${sessionId}`, async () => {
      const session = await SessionStore.get(sessionId);
      if (!session) throw new Error('Sesión no encontrada.');
      const trap = learnStartFinish(session.records);
      if (!trap) throw new Error('No se pudo deducir la meta en esa sesión.');
      const trackName = name.trim() || `Circuito desde ${session.meta.name}`;
      const id = await TrackStore.save({
        name: trackName,
        startFinish: trap,
        splits: [],
        centerline: sessionCenterline(session.records),
      });
      setName('');
      await refresh();
      onSelectTrack(id);
      setMessage(`Circuito «${trackName}» creado y activado. Ajusta meta y splits en el editor de abajo si quieres.`);
    });

  const applyPick = (point) =>
    run('pick', async () => {
      if (!activeTrack) throw new Error('Selecciona un circuito activo primero.');
      if (placement === 'none') {
        setMessage('Elige primero «Colocar meta» o «Añadir split» y luego toca el mapa.');
        return;
      }
      if (placement === 'startFinish') {
        await TrackStore.save({
          ...activeTrack,
          startFinish: makeTrap({
            lat: point.lat,
            lon: point.lon,
            heading: point.heading,
            width: activeTrack.startFinish?.width || 30,
            type: 'startFinish',
            name: 'Meta',
          }),
        });
        setMessage(`Meta colocada (${fmtCoord(point.lat)}, ${fmtCoord(point.lon)}) · sentido ${point.heading.toFixed(0)}°.`);
      } else {
        const splits = [...(activeTrack.splits || [])];
        splits.push(
          makeTrap({
            lat: point.lat,
            lon: point.lon,
            heading: point.heading,
            width: 30,
            type: 'split',
            name: `Split ${splits.length + 1}`,
          }),
        );
        await TrackStore.save({ ...activeTrack, splits });
        setMessage(`Split ${splits.length} colocado (${fmtCoord(point.lat)}, ${fmtCoord(point.lon)}) · sentido ${point.heading.toFixed(0)}°.`);
      }
      setPlacement('none');
      await refresh();
    });

  const removeSplit = (index) =>
    run(`split:${index}`, async () => {
      if (!activeTrack) return;
      const splits = (activeTrack.splits || []).filter((_, i) => i !== index);
      await TrackStore.save({ ...activeTrack, splits });
      await refresh();
      setMessage('Split eliminado.');
    });

  const attachCenterline = () =>
    run('centerline', async () => {
      if (!activeTrack) throw new Error('Selecciona un circuito activo primero.');
      if (!centerSessionId) throw new Error('Elige una sesión.');
      const session = await SessionStore.get(centerSessionId);
      if (!session) throw new Error('Sesión no encontrada.');
      await TrackStore.save({ ...activeTrack, centerline: sessionCenterline(session.records) });
      await refresh();
      setMessage('Trazada añadida: ya puedes editar meta y splits en el mapa.');
    });

  const onImportPasted = () =>
    run('paste', async () => {
      if (!activeTrack) throw new Error('Selecciona un circuito activo primero.');
      const points = parseCoordinateList(pasted);
      if (points.length < 3) {
        throw new Error('Pega al menos 3 líneas con "latitud, longitud" (una por punto del trazado).');
      }
      await TrackStore.save({ ...activeTrack, centerline: downsamplePoints(points, 800) });
      setPasted('');
      await refresh();
      setMessage(`Trazada creada con ${points.length} puntos. Ya puedes colocar meta y splits en el mapa.`);
    });

  const onImportFile = (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    run('import', async () => {
      if (!activeTrack) throw new Error('Selecciona un circuito activo primero.');
      const text = await file.text();
      const { format, points, total } = parseTrackFile(text);
      await TrackStore.save({ ...activeTrack, centerline: points });
      await refresh();
      setMessage(
        `Trazada importada (${format}, ${points.length} de ${total} puntos). Ya puedes colocar meta y splits en el mapa.`,
      );
    });
  };

  const invertStartFinish = () =>
    run('invert', async () => {
      if (!activeTrack) throw new Error('Selecciona un circuito activo primero.');
      const sf = activeTrack.startFinish;
      await TrackStore.save({
        ...activeTrack,
        startFinish: { ...sf, heading: (sf.heading + 180) % 360 },
      });
      await refresh();
      setMessage('Sentido de la meta invertido. Comprueba que ahora sí cuenta las vueltas.');
    });

  const rename = (track) =>
    run(`rename:${track.id}`, async () => {
      const next = window.prompt('Nuevo nombre del circuito', track.name);
      if (next === null) return;
      await TrackStore.save({ ...track, name: next.trim() || track.name });
      await refresh();
    });

  const remove = (track) =>
    run(`remove:${track.id}`, async () => {
      if (!window.confirm(`¿Borrar el circuito «${track.name}»?`)) return;
      await TrackStore.remove(track.id);
      if (track.id === activeTrackId) onSelectTrack(null);
      await refresh();
    });

  return (
    <>
      <section className="rb-card">
        <div className="rb-card-head">
          <h2>Circuito activo</h2>
          <span className={`rb-pill ${activeTrack ? 'rb-pill-connected' : 'rb-pill-idle'}`}>
            {activeTrack ? activeTrack.name : 'sin circuito'}
          </span>
        </div>

        {!activeTrack && (
          <p className="rb-note">
            Formas de fijar la meta, de más cómoda a menos:
            <br />
            0. <b>Editor sobre el mapa</b> (abajo): activa un circuito (los precargados ya tienen
            trazada) y toca el mapa para colocar meta y splits. El sentido sale de la trazada.
            <br />
            1. <b>Desde una sesión grabada</b>: rueda 2–3 vueltas grabando (sin circuito) y crea el
            circuito desde esa sesión.
            <br />
            2. <b>Pulsando al cruzar la línea</b> a velocidad baja (con copiloto).
            <br />
            3. <b>Parado sobre la línea</b>: rápido, pero el rumbo GPS parado no es fiable.
          </p>
        )}

        <div className="rb-toolbar">
          <label className="rb-field" style={{ minWidth: 200 }}>
            <span className="rb-field-label">Nombre del circuito nuevo (opcional)</span>
            <input
              type="text"
              value={name}
              placeholder="Karting La Esperanza"
              onChange={(e) => setName(e.target.value)}
              disabled={!!busy}
            />
          </label>
          <button type="button" className="rb-btn rb-btn-primary" onClick={createFromCurrent} disabled={!connected || !!busy || !latest}>
            Marcar meta aquí
          </button>
          <button
            type="button"
            className="rb-btn"
            onClick={addSplitCurrent}
            disabled={!activeTrack || !activeTrack.startFinish || !connected || !!busy || !latest}
          >
            Añadir split aquí
          </button>
          <button
            type="button"
            className="rb-btn"
            onClick={invertStartFinish}
            disabled={!activeTrack || !activeTrack.startFinish || !!busy}
          >
            Invertir sentido meta
          </button>
        </div>
        <p className="rb-muted" style={{ marginTop: 4 }}>
          {latest
            ? `Posición actual: ${fmtCoord(latest.latitude)}, ${fmtCoord(latest.longitude)} · rumbo ${(latest.heading || 0).toFixed(0)}° · ${latest.speed.toFixed(1)} km/h`
            : 'Sin posición en vivo. Conéctate y pulsa «Iniciar recepción» en la pestaña En vivo.'}
        </p>
        {latest && latest.speed < 1 && (
          <p className="rb-alert rb-alert-warn">
            El kart está casi parado: el <b>rumbo</b> que se guardará puede no ser fiable. Rueda muy
            despacio al marcar, o marca la meta desde una sesión grabada. Si la meta no cuenta las
            vueltas, pulsa «Invertir sentido meta».
          </p>
        )}

        {message && <p className="rb-note">{message}</p>}
        {error && <p className="rb-alert rb-alert-error">{error}</p>}
      </section>

      {activeTrack && (
        <section className="rb-card">
          <div className="rb-card-head">
            <h2>Editor de circuito</h2>
            <span className="rb-muted">{activeTrack.name}</span>
          </div>

          <div className="rb-toolbar">
            <button
              type="button"
              className={`rb-btn${placement === 'startFinish' ? ' rb-btn-primary' : ''}`}
              onClick={() => setPlacement(placement === 'startFinish' ? 'none' : 'startFinish')}
            >
              Colocar meta
            </button>
            <button
              type="button"
              className={`rb-btn${placement === 'split' ? ' rb-btn-primary' : ''}`}
              onClick={() => setPlacement(placement === 'split' ? 'none' : 'split')}
            >
              Añadir split
            </button>
            {placement !== 'none' && (
              <button type="button" className="rb-btn" onClick={() => setPlacement('none')}>
                Cancelar
              </button>
            )}
          </div>

          {placement !== 'none' && (
            <p className="rb-note">
              Toca sobre la <b>línea azul</b> del mapa para colocar {placement === 'startFinish' ? 'la meta' : 'el split'}.
              El sentido se toma automáticamente de la dirección de la trazada (no dependes del rumbo del GPS parado).
            </p>
          )}

          <TrackEditor
            points={activeTrack.centerline || []}
            traps={[activeTrack.startFinish, ...(activeTrack.splits || [])].filter(Boolean)}
            onPick={applyPick}
          />

          {(activeTrack.splits || []).length > 0 && (
            <div className="rb-table-wrap" style={{ marginTop: 10 }}>
              <table className="rb-table">
                <thead>
                  <tr>
                    <th>Split</th>
                    <th>Posición</th>
                    <th>Sentido</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {activeTrack.splits.map((s, i) => (
                    <tr key={i}>
                      <td className="rb-mono">{s.name || `S${i + 1}`}</td>
                      <td className="rb-mono">{fmtCoord(s.lat)}, {fmtCoord(s.lon)}</td>
                      <td className="rb-mono">{s.heading.toFixed(0)}°</td>
                      <td className="rb-actions-cell">
                        <button type="button" className="rb-btn rb-btn-danger" disabled={!!busy} onClick={() => removeSplit(i)}>
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rb-toolbar" style={{ marginTop: 10 }}>
            <label className="rb-field" style={{ minWidth: 260 }}>
              <span className="rb-field-label">Importar trazada (GPX o KML)</span>
              <input
                type="file"
                accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml"
                onChange={onImportFile}
                disabled={!!busy}
              />
            </label>
            {sessions.length > 0 && (
              <>
                <label className="rb-field" style={{ minWidth: 220 }}>
                  <span className="rb-field-label">…o usar la trazada de una sesión</span>
                  <select value={centerSessionId} onChange={(e) => setCenterSessionId(e.target.value)} disabled={!!busy}>
                    <option value="">Elige una sesión…</option>
                    {sessions.slice(0, 15).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="rb-btn" onClick={attachCenterline} disabled={!!busy || !centerSessionId}>
                  Usar trazada
                </button>
              </>
            )}
          </div>
          <div className="rb-toolbar" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <label className="rb-field" style={{ flex: 1, minWidth: 260 }}>
              <span className="rb-field-label">…o pegar coordenadas (una por línea: latitud, longitud)</span>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={4}
                placeholder={'28.4668, -16.3485\n28.4671, -16.3489\n…'}
                disabled={!!busy}
                style={{ fontFamily: 'var(--font-mono)', width: '100%', resize: 'vertical' }}
              />
            </label>
            <button type="button" className="rb-btn rb-btn-primary" onClick={onImportPasted} disabled={!!busy || !pasted.trim()}>
              Usar coordenadas
            </button>
          </div>
          <p className="rb-hint">
            Consejo: en Google Maps, clic derecho en cada punto del circuito → copiar «28.4668, -16.3485»
            y pégalos aquí (una línea por punto, ~15–30 para que quede bien; en el bucle con árboles
            ve punteando los que puedas). Si prefieres dibujar: en <b>Google My Maps</b>
            (mymaps.google.com) → «Añadir línea» → dibuja la pista → «Exportar a KML» → súbelo arriba
            con «Importar trazada». Lo más exacto sigue siendo grabar una vuelta y crear el circuito
            desde esa sesión.
          </p>
        </section>
      )}

      <section className="rb-card">
        <div className="rb-card-head">
          <h2>Mis circuitos</h2>
          <span className="rb-muted">{tracks.length}</span>
        </div>
        {tracks.length === 0 ? (
          <p className="rb-muted">Todavía no hay circuitos guardados.</p>
        ) : (
          <div className="rb-table-wrap">
            <table className="rb-table">
              <thead>
                <tr>
                  <th>Activo</th>
                  <th>Circuito</th>
                  <th>Meta</th>
                  <th>Splits</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tracks.map((t) => (
                  <tr key={t.id} className={t.id === activeTrackId ? 'rb-row-active' : ''}>
                    <td>
                      <input
                        type="radio"
                        name="active-track"
                        checked={t.id === activeTrackId}
                        onChange={() => onSelectTrack(t.id)}
                        aria-label={`Activar ${t.name}`}
                      />
                    </td>
                    <td>{t.name}</td>
                    <td className="rb-mono rb-break">
                      {t.startFinish ? (
                        <>
                          {fmtCoord(t.startFinish.lat)}, {fmtCoord(t.startFinish.lon)}
                          <br />
                          <span className="rb-muted">
                            ancho {t.startFinish.width} m · rumbo {t.startFinish.heading.toFixed(0)}°
                            {t.startFinish.bidirectional ? ' · bidireccional' : ''}
                          </span>
                        </>
                      ) : (
                        <span className="rb-muted">meta pendiente: márcala en el sitio</span>
                      )}
                      {t.builtin && (
                        <>
                          <br />
                          <span className="rb-tag">incluido</span>{' '}
                          <span className="rb-muted">{t.source}</span>
                        </>
                      )}
                    </td>
                    <td className="rb-mono">{(t.splits || []).length}</td>
                    <td className="rb-actions-cell">
                      <button type="button" className="rb-btn" disabled={!!busy} onClick={() => rename(t)}>
                        Renombrar
                      </button>{' '}
                      <button type="button" className="rb-btn rb-btn-danger" disabled={!!busy} onClick={() => remove(t)}>
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rb-card">
        <div className="rb-card-head">
          <h2>Crear circuito desde una sesión</h2>
          <span className="rb-muted">{sessions.length} sesiones</span>
        </div>
        <p className="rb-muted">
          Como el «Method A» de RaceChrono: graba unas vueltas, descarga la sesión y crea el circuito
          desde ella (se deduce la meta del cruce de la trazada).
        </p>
        {sessions.length === 0 ? (
          <p className="rb-muted">No hay sesiones guardadas todavía.</p>
        ) : (
          <div className="rb-table-wrap">
            <table className="rb-table">
              <thead>
                <tr>
                  <th>Sesión</th>
                  <th>Fecha</th>
                  <th>Registros</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 10).map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="rb-mono">{s.startedAt ? s.startedAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td className="rb-mono">{s.recordCount}</td>
                    <td className="rb-actions-cell">
                      <button
                        type="button"
                        className="rb-btn rb-btn-primary"
                        disabled={!!busy}
                        onClick={() => learnFromSession(s.id)}
                      >
                        Crear circuito
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
