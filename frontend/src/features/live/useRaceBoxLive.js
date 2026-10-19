import { useCallback, useEffect, useRef, useState } from 'react';
import { RaceBoxAdapter } from '../../services/devices/racebox/RaceBoxAdapter.js';
import { RaceBoxLiveBridge } from '../../services/devices/racebox/RaceBoxLiveBridge.js';
import { TrackStore } from '../../services/storage/TrackStore.js';
import { BUILTIN_TRACKS } from '../../data/builtinTracks.js';

const ACTIVE_TRACK_KEY = 'inlap-active-track';

export function useRaceBoxLive() {
  const [adapter] = useState(() => new RaceBoxAdapter());
  const [track, setTrack] = useState(null);
  const [snapshot, setSnapshot] = useState(() => adapter.getSnapshot());
  const [context, setContext] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [simTrackName, setSimTrackName] = useState(null);
  const [tracks, setTracks] = useState([]);
  const bridgeRef = useRef(null);
  const simRef = useRef(false);
  const simTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let trackId = null;
    try {
      trackId = window.localStorage.getItem(ACTIVE_TRACK_KEY);
    } catch (_) {
      trackId = null;
    }
    if (!trackId) {
      setTrack(null);
      return undefined;
    }
    TrackStore.get(trackId)
      .then((loaded) => {
        if (!cancelled) setTrack(loaded || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (simRef.current) return;
    bridgeRef.current = new RaceBoxLiveBridge(track);
  }, [track]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await TrackStore.ensureBuiltins(BUILTIN_TRACKS);
        const list = await TrackStore.list();
        if (!cancelled) setTracks(list || []);
      } catch (_) {
        if (!cancelled) setTracks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    adapter.initialize();
    const unsubscribe = adapter.addRecordListener((record) => {
      if (simRef.current) return;
      if (bridgeRef.current) bridgeRef.current.push(record);
    });
    const timer = setInterval(() => {
      setSnapshot(adapter.getSnapshot());
      setContext(bridgeRef.current ? bridgeRef.current.getContext() : null);
    }, 200);
    return () => {
      clearInterval(timer);
      unsubscribe();
      adapter.destroy();
    };
  }, [adapter]);

  useEffect(() => () => {
    if (simTimerRef.current) clearInterval(simTimerRef.current);
  }, []);

  const scan = useCallback(() => adapter.startScan(), [adapter]);
  const stopScan = useCallback(() => adapter.stopScan(), [adapter]);
  const connect = useCallback(
    async (deviceId) => {
      await adapter.connect(deviceId);
      await adapter.startReceiving();
    },
    [adapter]
  );
  const disconnect = useCallback(() => adapter.disconnect(), [adapter]);

  const selectTrack = useCallback(async (trackId) => {
    const loaded = await TrackStore.get(trackId);
    if (!loaded) return null;
    try {
      window.localStorage.setItem(ACTIVE_TRACK_KEY, trackId);
    } catch (_) {
      /* storage unavailable */
    }
    if (!simRef.current) setTrack(loaded);
    return loaded;
  }, []);

  const stopSimulate = useCallback(() => {
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    simRef.current = false;
    setSimulating(false);
    setSimTrackName(null);
    bridgeRef.current = new RaceBoxLiveBridge(track);
  }, [track]);

  const simulate = useCallback(async () => {
    if (!import.meta.env.DEV || simRef.current) return;
    const { buildSimulation } = await import('./demoTrack.js');
    const simulation = buildSimulation({ track, laps: 3, hz: 25 });
    if (!simulation) return;
    const { track: simTrack, records } = simulation;

    bridgeRef.current = new RaceBoxLiveBridge(simTrack);
    simRef.current = true;
    setSimulating(true);
    setSimTrackName(simTrack.name || 'sim');

    let index = 0;
    const warm = Math.min(records.length, 120);
    for (; index < warm; index += 1) bridgeRef.current.push(records[index]);

    simTimerRef.current = setInterval(() => {
      const bridge = bridgeRef.current;
      for (let step = 0; step < 4 && index < records.length && bridge; step += 1) {
        bridge.push(records[index]);
        index += 1;
      }
      if (index >= records.length && simTimerRef.current) {
        clearInterval(simTimerRef.current);
        simTimerRef.current = null;
      }
    }, 40);
  }, [track]);

  return {
    adapter,
    snapshot,
    context,
    track,
    scan,
    stopScan,
    connect,
    disconnect,
    simulate,
    stopSimulate,
    simulating,
    simTrackName,
    tracks,
    selectTrack,
  };
}
