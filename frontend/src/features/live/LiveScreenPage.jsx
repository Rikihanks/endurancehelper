import { useEffect, useMemo, useState } from 'react';
import LiveGrid from './LiveGrid.jsx';
import LiveControlBar from './LiveControlBar.jsx';
import { PRESETS, PRESET_ORDER, getPreset } from './liveConfig.js';
import { MOCK_MODEL, EMPTY_MODEL } from './liveMock.js';
import { useActiveSessionId, useLiveScreenModel } from './useLiveScreenModel.js';
import { useRaceBoxLive } from './useRaceBoxLive.js';
import {
  keepScreenAwake,
  releaseScreenAwake,
  lockCurrentOrientation,
  unlockOrientation,
} from '../../services/platform/screen.js';
import './live-screen.css';

const IS_DEV = import.meta.env.DEV;

function useOrientation() {
  const query = '(orientation: portrait)';
  const [portrait, setPortrait] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event) => setPortrait(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return portrait ? 'portrait' : 'landscape';
}

function RaceBoxDevConnect({ live }) {
  const [selected, setSelected] = useState('');
  const devices = live.snapshot.devices || [];
  const connected = !!live.snapshot.connectedDeviceId;
  return (
    <div className="live-dev-rb">
      <span>
        RB {live.snapshot.connectionState}
        {connected ? (live.snapshot.receiving ? ' · recibiendo' : ' · conectado') : ''}
      </span>
      {!connected && (
        <button type="button" onClick={live.scan}>Escanear</button>
      )}
      {!connected && devices.length > 0 && (
        <>
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Selecciona…</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>{device.name || device.localName || device.id}</option>
            ))}
          </select>
          <button type="button" disabled={!selected} onClick={() => live.connect(selected)}>Conectar</button>
        </>
      )}
      {connected && (
        <button type="button" onClick={live.disconnect}>Desconectar</button>
      )}
      {live.track && <span>· {live.track.name}</span>}
      {live.context && <span>· V{live.context.currentLap} ({live.context.laps})</span>}
    </div>
  );
}

export default function LiveScreenPage() {
  const orientation = useOrientation();
  const [presetId, setPresetId] = useState('full');
  const [orientationLocked, setOrientationLocked] = useState(false);
  const [recording, setRecording] = useState(false);

  const sessionId = useActiveSessionId();
  const raceBox = useRaceBoxLive();
  const liveModel = useLiveScreenModel(sessionId, raceBox.context);
  const hasReal = !!(liveModel && liveModel.hasData);
  const model = hasReal ? liveModel : IS_DEV ? MOCK_MODEL : EMPTY_MODEL;
  const usingMock = IS_DEV && !hasReal;
  const preset = useMemo(() => getPreset(presetId), [presetId]);

  useEffect(() => {
    keepScreenAwake();
    return () => {
      releaseScreenAwake();
    };
  }, []);

  const toggleOrientation = async () => {
    if (orientationLocked) {
      await unlockOrientation();
      setOrientationLocked(false);
    } else {
      const locked = await lockCurrentOrientation();
      setOrientationLocked(locked);
    }
  };

  const toggleRecording = IS_DEV ? () => setRecording((value) => !value) : null;

  return (
    <div className="live-page" data-orientation={orientation}>
      {IS_DEV && (
        <div className="live-devtools">
          <span className={`live-mock-badge ${usingMock ? '' : sessionId ? 'is-live' : 'is-offline'}`}>
            {usingMock ? 'MOCK · DEV' : sessionId ? 'INLAP · EN DIRECTO' : 'INLAP · SIN SESIÓN'}
          </span>
          <label className="live-dev-select">
            <span>Grid</span>
            <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
              {PRESET_ORDER.map((id) => (
                <option key={id} value={id}>{PRESETS[id].name}</option>
              ))}
            </select>
          </label>
          <RaceBoxDevConnect live={raceBox} />
        </div>
      )}

      <main className="live-stage">
        <LiveGrid preset={preset} model={model} orientation={orientation} />
      </main>

      <LiveControlBar
        orientationLocked={orientationLocked}
        onToggleOrientation={toggleOrientation}
        recording={!!toggleRecording && recording}
        onToggleRecording={toggleRecording}
        onOpenConfig={null}
      />
    </div>
  );
}
