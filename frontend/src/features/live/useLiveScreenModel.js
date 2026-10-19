import { useEffect, useState } from 'react';
import { connectLive, listRaceSessions } from '../../api.js';
import { buildLiveScreenModel } from './liveModel.js';

export function useActiveSessionId() {
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await listRaceSessions();
        const running = (data.sessions || []).filter((session) => session.status === 'running');
        const active = running.find((session) => session.live) || running[0] || null;
        if (alive) setSessionId(active ? active.id : null);
      } catch (_) {
        if (alive) setSessionId(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return sessionId;
}

export function useLiveScreenModel(sessionId) {
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setPayload(null);
      return undefined;
    }
    const close = connectLive((snapshot) => setPayload(snapshot), sessionId);
    return () => {
      if (typeof close === 'function') close();
    };
  }, [sessionId]);

  return buildLiveScreenModel(payload);
}
