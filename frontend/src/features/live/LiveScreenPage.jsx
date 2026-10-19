import { useEffect, useMemo, useRef, useState } from 'react';
import LiveGrid from './LiveGrid.jsx';
import LiveControlBar from './LiveControlBar.jsx';
import LiveConfigPanel from './LiveConfigPanel.jsx';
import RaceBoxConnector from './RaceBoxConnector.jsx';
import { CircuitPicker, RecordBanner, StopDialog } from './LiveRecordSheets.jsx';
import { PRESETS, PRESET_ORDER, getPreset } from './liveConfig.js';
import { getCells, getOverrides } from './liveGridStore.js';
import { useLiveGridConfig } from './useLiveGridConfig.js';
import { MOCK_MODEL, EMPTY_MODEL } from './liveMock.js';
import { buildLiveScreenModel, selectModel, selectSource } from './liveModel.js';
import { useActiveSessionId, useLiveScreenModel } from './useLiveScreenModel.js';
import { useRaceBoxLive } from './useRaceBoxLive.js';
import { useLiveRecorder } from './useLiveRecorder.js';
import { appVersion, buildSessionHeader } from './recorderModel.js';
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
  const [configOpen, setConfigOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [recordError, setRecordError] = useState(null);

  const sessionId = useActiveSessionId();
  const raceBox = useRaceBoxLive();
  const inLapModel = useLiveScreenModel(sessionId, raceBox.context);
  const raceBoxModel = useMemo(() => buildLiveScreenModel({}, raceBox.context), [raceBox.context]);

  const hasInLap = !!(inLapModel && inLapModel.hasData);
  const hasRaceBox = !!raceBox.context && (raceBox.context.started || raceBox.context.laps > 0);
  const source = selectSource({ hasInLap, simulating: raceBox.simulating, hasRaceBox, isDev: IS_DEV });
  const model = selectModel(source, {
    inLapModel,
    raceBoxModel,
    mockModel: MOCK_MODEL,
    emptyModel: EMPTY_MODEL,
  });

  const preset = useMemo(() => getPreset(presetId), [presetId]);
  const grid = useLiveGridConfig();
  const cells = useMemo(
    () => getCells(preset, getOverrides(grid.config, presetId)),
    [preset, grid.config, presetId]
  );

  const modelRef = useRef(model);
  modelRef.current = model;
  const contextRef = useRef(raceBox.context);
  contextRef.current = raceBox.context;

  const recorder = useLiveRecorder({
    adapter: raceBox.adapter,
    connected: !!raceBox.snapshot.connectedDeviceId,
    readScreen: () => ({ model: modelRef.current, context: contextRef.current }),
  });

  useEffect(() => {
    keepScreenAwake();
    return () => {
      releaseScreenAwake();
    };
  }, []);

  useEffect(() => {
    if (!recorder.recording) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [recorder.recording]);

  const toggleOrientation = async () => {
    if (orientationLocked) {
      await unlockOrientation();
      setOrientationLocked(false);
    } else {
      const locked = await lockCurrentOrientation();
      setOrientationLocked(locked);
    }
  };

  const onRecordToggle = () => {
    if (recorder.recording) {
      setStopOpen(true);
      return;
    }
    setRecordError(null);
    if (!raceBox.snapshot.connectedDeviceId) {
      setRecordError('Conecta la RaceBox para grabar.');
      setConfigOpen(true);
      return;
    }
    setPickerOpen(true);
  };

  const startRecording = async (trackId) => {
    const track = await raceBox.selectTrack(trackId);
    if (!track) {
      setRecordError('No se pudo cargar el circuito.');
      return;
    }
    setPickerOpen(false);
    recorder.start(
      buildSessionHeader({
        track,
        kart: modelRef.current ? modelRef.current.kart : null,
        raceboxModel: raceBox.snapshot.connectedDeviceName || null,
        raceboxId: raceBox.snapshot.connectedDeviceId || null,
        preset: presetId,
        appVersion: appVersion(),
        startedAt: new Date().toISOString(),
      })
    );
  };

  const confirmStop = async () => {
    setStopOpen(false);
    await recorder.stop();
  };

  const dismissBanner = () => {
    setRecordError(null);
    recorder.dismissWarning();
    recorder.dismissMessage();
    recorder.dismissError();
  };

  const banner = recorder.error
    ? { kind: 'error', text: recorder.error }
    : recordError
      ? { kind: 'error', text: recordError }
      : recorder.warning
        ? { kind: 'warn', text: recorder.warning }
        : recorder.message
          ? { kind: 'ok', text: recorder.message }
          : null;

  return (
    <div className="live-page" data-orientation={orientation}>
      {IS_DEV && (
        <div className="live-devtools">
          <span className={`live-mock-badge ${source === 'mock' || source === 'sim' ? '' : source === 'none' ? 'is-offline' : 'is-live'}`}>
            {source === 'mock' ? 'MOCK · DEV'
              : source === 'sim' ? 'SIM · DEV'
              : source === 'inlap' ? 'INLAP · EN DIRECTO'
              : source === 'racebox' ? 'RACEBOX · SIN INLAP'
              : 'SIN SESIÓN'}
          </span>
          <label className="live-dev-select">
            <span>Grid</span>
            <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
              {PRESET_ORDER.map((id) => (
                <option key={id} value={id}>{PRESETS[id].name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="live-dev-sim"
            onClick={raceBox.simulating ? raceBox.stopSimulate : raceBox.simulate}
          >
            {raceBox.simulating ? 'Parar sim' : 'Simular'}
          </button>
          <span className="live-dev-state">
            {raceBox.simulating
              ? `sim: ${raceBox.simTrackName}`
              : raceBox.track ? raceBox.track.name : 'sin circuito'}
            {raceBox.context
              ? ` · V${raceBox.context.currentLap} · ${raceBox.context.laps} v`
                + (raceBox.context.deltaSeconds != null ? ` · Δ${raceBox.context.deltaSeconds.toFixed(2)}` : '')
                + (raceBox.context.sectorCount ? ` · ${raceBox.context.sectorCount} sec` : '')
              : ''}
            {recorder.recording ? ` · grabando ${recorder.recordCount}` : ''}
          </span>
        </div>
      )}

      <main className="live-stage">
        <LiveGrid cells={cells} model={model} orientation={orientation} />
      </main>

      <LiveControlBar
        orientationLocked={orientationLocked}
        onToggleOrientation={toggleOrientation}
        recording={recorder.recording}
        onToggleRecording={onRecordToggle}
        onOpenConfig={() => setConfigOpen(true)}
      />

      {banner && (
        <div className="live-banners">
          <RecordBanner kind={banner.kind} onClose={dismissBanner}>{banner.text}</RecordBanner>
        </div>
      )}

      {configOpen && (
        <LiveConfigPanel
          presetId={presetId}
          onSelectPreset={setPresetId}
          config={grid.config}
          onAssign={grid.assign}
          onReset={grid.reset}
          onClose={() => setConfigOpen(false)}
          raceBox={raceBox}
        />
      )}

      {pickerOpen && (
        <CircuitPicker
          tracks={raceBox.tracks}
          activeTrackId={raceBox.track ? raceBox.track.id : null}
          onConfirm={startRecording}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {stopOpen && (
        <StopDialog busy={false} onCancel={() => setStopOpen(false)} onConfirm={confirmStop} />
      )}
    </div>
  );
}
