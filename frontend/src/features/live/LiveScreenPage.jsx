import { useEffect, useMemo, useState } from 'react';
import LiveGrid from './LiveGrid.jsx';
import LiveControlBar from './LiveControlBar.jsx';
import { PRESETS, PRESET_ORDER, getPreset } from './liveConfig.js';
import { MOCK_MODEL, EMPTY_MODEL } from './liveMock.js';
import { useActiveSessionId, useLiveScreenModel } from './useLiveScreenModel.js';
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

export default function LiveScreenPage() {
  const orientation = useOrientation();
  const [presetId, setPresetId] = useState('full');
  const [orientationLocked, setOrientationLocked] = useState(false);
  const [recording, setRecording] = useState(false);

  const sessionId = useActiveSessionId();
  const liveModel = useLiveScreenModel(sessionId);
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
