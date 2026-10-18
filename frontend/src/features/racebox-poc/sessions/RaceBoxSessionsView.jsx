import { useCallback, useEffect, useState } from 'react';
import { SessionStore } from '../../../services/storage/SessionStore.js';
import {
  detectLaps,
  sessionStats,
  formatLapTime,
  toGpx,
  toCsv,
} from '../../../services/devices/racebox/RaceBoxAnalysis.js';
import SessionViewer from './SessionViewer.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { exportTextFile, pluginAvailable } from '../../../services/platform/exportFile.js';
import { isNativePlatform, runtimePlatform } from '../../../services/bluetooth/index.js';

function sessionName(records, index) {
  const stats = { startDate: null };
  try {
    const s = sessionStats(records, []);
    stats.startDate = s.startDate;
  } catch (_) {
    /* ignore */
  }
  if (stats.startDate) {
    return `Sesión ${stats.startDate.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
  return `Sesión descargada #${index + 1}`;
}

export default function RaceBoxSessionsView({ adapter, snapshot }) {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [code, setCode] = useState('123456');
  const [diag, setDiag] = useState([]);

  const connected = !!snapshot.connectedDeviceId;
  const history = snapshot.history || { phase: 'idle', expected: 0, received: 0 };
  const downloading = history.phase === 'unlocking' || history.phase === 'requested' || history.phase === 'receiving';
  const progress =
    history.expected > 0 ? Math.min(100, Math.round((history.received / history.expected) * 100)) : null;

  const refresh = useCallback(async () => {
    try {
      setSessions(await SessionStore.list());
    } catch (err) {
      setError(String(err.message || err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(name, fn) {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(null);
    }
  }

  const onQueryStatus = () =>
    run('status', async () => {
      const status = await adapter.queryMemoryStatus();
      setMessage(
        status
          ? `Memoria: ${status.memoryPercent}% usada · estado ${status.recording ? 'grabando' : 'inactivo'} · ` +
            `${status.recordCount ?? '?'}/${status.memorySize ?? '?'} registros · seguridad ${
              status.securityEnabled ? 'activada' : 'desactivada'
            }`
          : null,
      );
    });

  const onDownload = () =>
    run('download', async () => {
      setMessage('Descargando memoria del dispositivo… la telemetría en vivo se detiene mientras dura.');
      const { sessions: downloaded, expected, received } = await adapter.startHistoryDownload({
        securityCode: Number(code) || 123456,
      });
      if (!downloaded.length) {
        setMessage(`Descarga completada: la memoria del dispositivo está vacía (${received}/${expected}).`);
        return;
      }
      let saved = 0;
      for (let i = 0; i < downloaded.length; i++) {
        const records = downloaded[i].records;
        if (records.length < 2) continue;
        const laps = detectLaps(records);
        const stats = sessionStats(records, laps);
        await SessionStore.save({
          meta: {
            name: sessionName(records, i),
            deviceName: snapshot.connectedDeviceName,
            deviceId: snapshot.connectedDeviceId,
            source: 'device',
            startedAt: stats.startDate ? stats.startDate.toISOString() : null,
            durationS: stats.durationS,
            distanceM: stats.distanceM,
            maxSpeed: stats.maxSpeed,
            maxG: stats.maxG,
            lapCount: stats.lapCount,
            bestLapS: stats.bestLap ? stats.bestLap.durationS : null,
          },
          records,
        });
        saved += 1;
      }
      await refresh();
      setMessage(`Descarga completada: ${saved} sesión(es) guardadas de ${received}/${expected} registros.`);
    });

  const onErase = () => {
    if (!window.confirm('¿Borrar TODA la memoria del dispositivo? Esta acción es irreversible.')) return;
    run('erase', async () => {
      await adapter.eraseDeviceMemory();
      setMessage('Memoria del dispositivo borrada.');
    });
  };

  const onDelete = (id) =>
    run(`delete:${id}`, async () => {
      await SessionStore.remove(id);
      await refresh();
    });

  const runDiagnostics = () =>
    run('diag', async () => {
      const lines = [];
      const add = (t) => lines.push(`${new Date().toLocaleTimeString()} · ${t}`);
      setDiag([]);
      try {
        const cap = typeof window !== 'undefined' ? window.Capacitor : null;
        add(
          `build=${typeof __INLAP_BUILD__ !== 'undefined' ? __INLAP_BUILD__ : 'dev'} · runtime=${runtimePlatform()} · native=${isNativePlatform()} · Capacitor=${cap ? 'sí' : 'no'}`,
        );
        add(
          `plugins: Filesystem=${pluginAvailable('Filesystem')} · Share=${pluginAvailable('Share')} · BluetoothLe=${pluginAvailable('BluetoothLe')}`,
        );
        if (typeof navigator !== 'undefined') add(`UA=${String(navigator.userAgent).slice(0, 90)}`);
      } catch (err) {
        add(`ERROR entorno: ${err && err.message}`);
      }
      try {
        const list = await SessionStore.list();
        add(`sesiones guardadas=${list.length}`);
        if (list.length) {
          const full = await SessionStore.get(list[0].id);
          const recs = full && full.records;
          add(
            `sesión[0]: id=${full && full.id} · records=${Array.isArray(recs) ? recs.length : 'NO ES ARRAY'}`,
          );
          if (Array.isArray(recs) && recs[0]) {
            add(`record[0].keys=${Object.keys(recs[0]).join(',')}`);
            add(`record[0].lat=${recs[0].latitude} lon=${recs[0].longitude} speed=${recs[0].speed}`);
          }
        }
      } catch (err) {
        add(`ERROR leyendo sesión: ${err && err.name}: ${err && err.message}`);
      }
      try {
        const res = await exportTextFile('inlap-diagnostico.csv', 'a,b\n1,2\n', 'text/csv');
        add(`export OK · via=${res.via} · file=${res.filename}${res.warning ? ` · warning=${res.warning}` : ''}`);
      } catch (err) {
        add(`ERROR export: ${err && err.name}: ${err && err.message}`);
        add(`stack=${String((err && err.stack) || '').split('\n').slice(0, 3).join(' | ')}`);
      }
      setDiag(lines);
    });

  if (selected) {
    return (
      <ErrorBoundary onReset={() => setSelected(null)} resetLabel="Volver a sesiones">
        <SessionViewer sessionId={selected} onClose={() => setSelected(null)} />
      </ErrorBoundary>
    );
  }

  return (
    <>
      <section className="rb-card">
        <div className="rb-card-head">
          <h2>Descargar sesiones del dispositivo</h2>
          <span className={`rb-pill ${connected ? 'rb-pill-connected' : 'rb-pill-idle'}`}>
            {connected ? 'RaceBox conectada' : 'Sin conexión'}
          </span>
        </div>

        {!connected && (
          <p className="rb-note">
            Conecta primero con la RaceBox en la pestaña «En vivo» (escanear → conectar). La descarga
            funciona con la app abierta; la telemetría en vivo se pausa mientras se descarga la memoria.
          </p>
        )}

        <div className="rb-toolbar">
          <label className="rb-field" style={{ minWidth: 180 }}>
            <span className="rb-field-label">Código de seguridad</span>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 9))}
              disabled={downloading || !!busy}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </label>
          <button type="button" className="rb-btn" onClick={onQueryStatus} disabled={!connected || !!busy || downloading}>
            Consultar memoria
          </button>
          <button type="button" className="rb-btn rb-btn-primary" onClick={onDownload} disabled={!connected || !!busy || downloading}>
            Descargar sesiones
          </button>
          <button
            type="button"
            className="rb-btn"
            onClick={() => adapter.cancelHistoryDownload()}
            disabled={!downloading}
          >
            Cancelar descarga
          </button>
          <button type="button" className="rb-btn rb-btn-danger" onClick={onErase} disabled={!connected || !!busy || downloading}>
            Borrar memoria
          </button>
        </div>

        {downloading && (
          <div className="rb-progress">
            <div className="rb-progress-bar" style={{ width: `${progress ?? 8}%` }} />
            <span>
              {history.phase === 'unlocking' && 'Desbloqueando memoria…'}
              {history.phase === 'requested' && 'Solicitando historial…'}
              {history.phase === 'receiving' &&
                `Recibiendo ${history.received}${history.expected ? ` / ${history.expected}` : ''} registros${progress != null ? ` (${progress}%)` : ''}`}
            </span>
          </div>
        )}

        {message && <p className="rb-note">{message}</p>}
        {error && <p className="rb-alert rb-alert-error">{error}</p>}
      </section>

      <section className="rb-card">
        <div className="rb-card-head">
          <h2>Sesiones guardadas</h2>
          <span className="rb-muted">{sessions.length} en este dispositivo</span>
        </div>

        {sessions.length === 0 ? (
          <p className="rb-muted">
            Todavía no hay sesiones. Descarga la memoria de la RaceBox o graba con la app oficial y
            descarga aquí después.
          </p>
        ) : (
          <div className="rb-table-wrap">
            <table className="rb-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Fecha</th>
                  <th>Vueltas</th>
                  <th>Mejor</th>
                  <th className="rb-hide-sm">V. máx</th>
                  <th className="rb-hide-sm">Dist.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="rb-mono">
                      {s.startedAt ? s.startedAt.slice(0, 16).replace('T', ' ') : '—'}
                    </td>
                    <td className="rb-mono">{s.lapCount ?? '—'}</td>
                    <td className="rb-mono">{s.bestLapS != null ? formatLapTime(s.bestLapS) : '—'}</td>
                    <td className="rb-mono rb-hide-sm">{s.maxSpeed != null ? `${s.maxSpeed.toFixed(0)}` : '—'}</td>
                    <td className="rb-mono rb-hide-sm">{s.distanceM != null ? `${(s.distanceM / 1000).toFixed(2)} km` : '—'}</td>
                    <td className="rb-actions-cell">
                      <button type="button" className="rb-btn rb-btn-primary" onClick={() => setSelected(s.id)}>
                        Ver
                      </button>{' '}
                      <button type="button" className="rb-btn" disabled={!!busy} onClick={() => onExport(s, 'gpx')}>
                        GPX
                      </button>{' '}
                      <button type="button" className="rb-btn" disabled={!!busy} onClick={() => onExport(s, 'csv')}>
                        CSV
                      </button>{' '}
                      <button type="button" className="rb-btn rb-btn-danger" disabled={!!busy} onClick={() => onDelete(s.id)}>
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

      <details className="rb-details">
        <summary>Diagnóstico (si algo no funciona)</summary>
        <p className="rb-hint">
          Ejecuta esto y pásame el texto: dice si la build incluye los plugins, si la sesión tiene
          registros y qué error exacto da la exportación.
        </p>
        <div className="rb-toolbar">
          <button type="button" className="rb-btn" onClick={runDiagnostics} disabled={!!busy}>
            Ejecutar diagnóstico
          </button>
        </div>
        {diag.length > 0 && <pre className="rb-hex rb-diag">{diag.join('\n')}</pre>}
      </details>
    </>
  );

  async function onExport(meta, format) {
    try {
      const full = await SessionStore.get(meta.id);
      if (!full) {
        setError('Sesión no encontrada.');
        return;
      }
      const text =
        format === 'gpx'
          ? toGpx(full.records, { name: meta.name })
          : toCsv(full.records);
      const res = await exportTextFile(
        `${meta.name}.${format}`,
        text,
        format === 'gpx' ? 'application/gpx+xml' : 'text/csv',
      );
      setError(null);
      setMessage(
        res.via === 'share'
          ? `${res.filename}: se abrió el menú para guardarlo o compartirlo.`
          : `Descargando ${res.filename}…`,
      );
    } catch (err) {
      setError(`No se pudo exportar: ${String((err && err.message) || err)}`);
    }
  }
}
