import { useCallback, useEffect, useRef, useState } from 'react';
import { RaceBoxAdapter } from '../../services/devices/racebox/RaceBoxAdapter.js';
import { RaceBoxLiveBridge } from '../../services/devices/racebox/RaceBoxLiveBridge.js';
import { TrackStore } from '../../services/storage/TrackStore.js';

const ACTIVE_TRACK_KEY = 'inlap-active-track';

export function useRaceBoxLive() {
  const [adapter] = useState(() => new RaceBoxAdapter());
  const [track, setTrack] = useState(null);
  const [snapshot, setSnapshot] = useState(() => adapter.getSnapshot());
  const [context, setContext] = useState(null);
  const bridgeRef = useRef(null);

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
    bridgeRef.current = new RaceBoxLiveBridge(track);
  }, [track]);

  useEffect(() => {
    adapter.initialize();
    const unsubscribe = adapter.addRecordListener((record) => {
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

  return { adapter, snapshot, context, track, scan, stopScan, connect, disconnect };
}
