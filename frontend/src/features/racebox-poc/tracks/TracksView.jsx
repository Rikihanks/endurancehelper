import { useCallback, useEffect, useState } from 'react';
import { TrackStore } from '../../../services/storage/TrackStore.js';
import { SessionStore } from '../../../services/storage/SessionStore.js';
import { makeTrap, learnStartFinish } from '../../../services/devices/racebox/RaceBoxTrack.js';

// Track library and editor: create a track from the current position (stand on
// the start/finish line) or learn one from a recorded session, add splits,
// rename/delete and pick the active track. This is what makes lap timing
// possible at a circuit that is not in any database (like a local karting).

function fmtCoord(v) {
  return Number(v).toFixed(6);
}

export default function TracksView({ adapter, snapshot, activeTrackId, onSelectTrack }) {
  const [tracks, setTracks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [name, setName] = useState('');

  const connected = !!snapshot.connectedDeviceId;
  const latest = snapshot.latest;

  const refresh = useCallback(async () => {
    try {
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
      const id = await TrackStore.save({ name: trackName, startFinish: trap, splits: [] });
      setName('');
      await refresh();
      onSelectTrack(id);
      setMessage(`Circuito «${trackName}» creado desde la sesión y activado.`);
    });

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
            Tres formas de fijar la meta, de más fiable a menos:
            <br />
            1. <b>Desde una sesión grabada</b> (abajo): rueda 2–3 vueltas con el cronómetro grabando
            (aunque no haya circuito) y crea el circuito desde esa sesión. La meta se deduce de tu
            trazada real.
            <br />
            2. <b>Pulsando al cruzar la línea</b> a velocidad baja (con copiloto; no uses el móvil
            conduciendo): posición y rumbo fiables.
            <br />
            3. <b>Parado sobre la línea</b> mirando al sentido de marcha: rápido, pero el rumbo GPS
            parado no es fiable.
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
          <button type="button" className="rb-btn" onClick={addSplitCurrent} disabled={!activeTrack || !connected || !!busy || !latest}>
            Añadir split aquí
          </button>
          <button type="button" className="rb-btn" onClick={invertStartFinish} disabled={!activeTrack || !!busy}>
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
                      {fmtCoord(t.startFinish.lat)}, {fmtCoord(t.startFinish.lon)}
                      <br />
                      <span className="rb-muted">ancho {t.startFinish.width} m · rumbo {t.startFinish.heading.toFixed(0)}°</span>
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
