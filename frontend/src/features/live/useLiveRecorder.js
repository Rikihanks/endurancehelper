import { useCallback, useEffect, useRef, useState } from 'react';
import { SessionStore } from '../../services/storage/SessionStore.js';
import { addGap, recordsDurationS } from './recorderModel.js';

export function useLiveRecorder({ adapter, connected, readScreen }) {
  const [recording, setRecording] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  const [savedId, setSavedId] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);

  const recordsRef = useRef([]);
  const snapshotsRef = useRef([]);
  const gapsRef = useRef([]);
  const headerRef = useRef(null);
  const recordingRef = useRef(false);
  const unsubRef = useRef(null);
  const timerRef = useRef(null);
  const lastLapRef = useRef(null);
  const hiddenRef = useRef(false);
  const readScreenRef = useRef(readScreen);
  readScreenRef.current = readScreen;

  const pushGap = useCallback((reason) => {
    const at = Date.now();
    const next = addGap(gapsRef.current, at, reason);
    if (next === gapsRef.current) return;
    gapsRef.current = next;
    setWarning(
      reason === 'racebox'
        ? 'RaceBox desconectada: sigo grabando y marco el hueco.'
        : 'La app perdió el primer plano: hueco marcado en la grabación.'
    );
  }, []);

  const start = useCallback(
    (header) => {
      if (recordingRef.current) return;
      recordsRef.current = [];
      snapshotsRef.current = [];
      gapsRef.current = [];
      headerRef.current = header;
      lastLapRef.current = null;
      setSavedId(null);
      setMessage(null);
      setError(null);
      setWarning(null);
      setRecordCount(0);

      unsubRef.current = adapter.addRecordListener((record) => {
        recordsRef.current.push(record);
      });

      timerRef.current = setInterval(() => {
        const screen = readScreenRef.current ? readScreenRef.current() : null;
        if (screen) {
          const lap = screen.context ? screen.context.currentLap : null;
          const isLapChange = snapshotsRef.current.length > 0 && lap !== lastLapRef.current;
          lastLapRef.current = lap;
          snapshotsRef.current.push({
            at: Date.now(),
            lap,
            event: isLapChange ? 'lap' : null,
            model: screen.model,
          });
        }
        setRecordCount(recordsRef.current.length);
      }, 1000);

      recordingRef.current = true;
      setRecording(true);
    },
    [adapter]
  );

  const stop = useCallback(async () => {
    if (!recordingRef.current) return null;
    recordingRef.current = false;
    setRecording(false);
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const records = recordsRef.current;
    if (records.length < 2) {
      setMessage('No se grabó nada que guardar.');
      return null;
    }

    const header = headerRef.current || {};
    const startedAt = header.startedAt || null;
    try {
      const id = await SessionStore.save({
        meta: {
          name: `En vivo ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${header.circuitName ? ` · ${header.circuitName}` : ''}`,
          deviceName: header.raceboxModel || null,
          deviceId: header.raceboxId || null,
          source: 'live-screen',
          startedAt,
          durationS: recordsDurationS(records),
          recordCount: records.length,
          header,
          gaps: gapsRef.current,
        },
        records,
        screenSnapshots: snapshotsRef.current,
      });
      setSavedId(id);
      setMessage('Grabación guardada.');
      return id;
    } catch (err) {
      setError(String(err.message || err));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!recording || connected) return;
    pushGap('racebox');
  }, [recording, connected, pushGap]);

  useEffect(() => {
    const onVisibility = () => {
      if (!recordingRef.current) return;
      if (document.hidden) {
        hiddenRef.current = true;
      } else if (hiddenRef.current) {
        hiddenRef.current = false;
        pushGap('background');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pushGap]);

  useEffect(() => () => {
    if (unsubRef.current) unsubRef.current();
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const dismissWarning = useCallback(() => setWarning(null), []);
  const dismissMessage = useCallback(() => setMessage(null), []);
  const dismissError = useCallback(() => setError(null), []);

  return {
    recording,
    recordCount,
    savedId,
    message,
    error,
    warning,
    start,
    stop,
    dismissWarning,
    dismissMessage,
    dismissError,
  };
}
