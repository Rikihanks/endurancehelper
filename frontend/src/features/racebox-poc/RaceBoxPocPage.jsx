import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { RaceBoxAdapter } from '../../services/devices/racebox/RaceBoxAdapter.js';
import RaceBoxStatus from './RaceBoxStatus.jsx';
import RaceBoxDataPanel from './RaceBoxDataPanel.jsx';
import RaceBoxSessionsView from './sessions/RaceBoxSessionsView.jsx';
import LiveTimingView from './live/LiveTimingView.jsx';
import TracksView from './tracks/TracksView.jsx';
import './racebox-poc.css';

const ACTIVE_TRACK_KEY = 'inlap-active-track';

// Isolated diagnostic + telemetry screen. It never touches race state, the
// backend or the strategy engine. Reachable at /racebox (path) or #racebox
// (hash) so it also works inside the Capacitor container.
export default function RaceBoxPocPage() {
  const [adapter] = useState(() => new RaceBoxAdapter());
  const snapshot = useSyncExternalStore(
    useCallback((listener) => adapter.subscribe(listener), [adapter]),
    useCallback(() => adapter.getSnapshot(), [adapter]),
    useCallback(() => adapter.getSnapshot(), [adapter]),
  );
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(null);
  const [tab, setTab] = useState('live');
  const [activeTrackId, setActiveTrackId] = useState(() => {
    try {
      return window.localStorage.getItem(ACTIVE_TRACK_KEY) || null;
    } catch (_) {
      return null;
    }
  });

  const selectTrack = useCallback((id) => {
    setActiveTrackId(id);
    try {
      if (id) window.localStorage.setItem(ACTIVE_TRACK_KEY, id);
      else window.localStorage.removeItem(ACTIVE_TRACK_KEY);
    } catch (_) {
      /* ignore */
    }
  }, []);

  // Initialize BLE on mount and release everything on unmount. The adapter
  // tolerates StrictMode's mount/unmount/remount cycle.
  useEffect(() => {
    adapter.initialize();
    return () => {
      adapter.destroy();
    };
  }, [adapter]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  async function run(name, fn) {
    if (busy) return;
    setBusy(name);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const tabs = [
    { id: 'live', label: 'En vivo' },
    { id: 'timing', label: 'Cronometraje' },
    { id: 'tracks', label: 'Circuitos' },
    { id: 'sessions', label: 'Sesiones' },
  ];

  return (
    <div className="rb-page">
      <header className="rb-header">
        <div>
          <p className="rb-kicker">InLap · Prueba de concepto</p>
          <h1>RaceBox Mini S · BLE</h1>
          <p className="rb-sub">
            Pantalla de diagnóstico aislada. No modifica la sesión de carrera ni el backend.
          </p>
        </div>
        <a className="rb-back" href="#home">Volver a InLap</a>
      </header>

      <nav className="rb-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rb-tab${tab === t.id ? ' rb-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'live' && (
        <>
          <RaceBoxStatus
            snapshot={snapshot}
            busy={busy}
            onRetryInit={() => run('init', () => adapter.initialize())}
            onScan={() => run('scan', () => adapter.startScan())}
            onStopScan={() => run('stopScan', () => adapter.stopScan())}
            onConnect={(id) => run(`connect:${id}`, () => adapter.connect(id))}
            onDisconnect={() => run('disconnect', () => adapter.disconnect())}
            onStartReceiving={() => run('startRx', () => adapter.startReceiving())}
            onStopReceiving={() => run('stopRx', () => adapter.stopReceiving())}
          />
          <RaceBoxDataPanel snapshot={snapshot} now={now} />
        </>
      )}

      {tab === 'timing' && (
        <LiveTimingView
          adapter={adapter}
          snapshot={snapshot}
          activeTrackId={activeTrackId}
          onGoToTracks={() => setTab('tracks')}
        />
      )}

      {tab === 'tracks' && (
        <TracksView
          adapter={adapter}
          snapshot={snapshot}
          activeTrackId={activeTrackId}
          onSelectTrack={selectTrack}
        />
      )}

      {tab === 'sessions' && <RaceBoxSessionsView adapter={adapter} snapshot={snapshot} />}

      <footer className="rb-footer">
        Protocolo basado en RaceBox BLE rev 9 (cliente de referencia lgnap/RaceBoxMicroBleClient).
        Ver <code>docs/racebox-protocol-research.md</code> y{' '}
        <code>docs/racebox-racechrono-replication.md</code> para fuentes y límites.
      </footer>
    </div>
  );
}
