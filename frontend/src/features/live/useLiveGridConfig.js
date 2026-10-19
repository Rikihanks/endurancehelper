import { useCallback, useEffect, useState } from 'react';
import { getPreset } from './liveConfig.js';
import { assignContent, readGridConfig, resetPreset, writeGridConfig } from './liveGridStore.js';

function storageOrDefault() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

export function useLiveGridConfig() {
  const [config, setConfig] = useState(() => readGridConfig(storageOrDefault()));

  useEffect(() => {
    writeGridConfig(storageOrDefault(), config);
  }, [config]);

  const assign = useCallback((presetId, slotIndex, contentId) => {
    setConfig((prev) => assignContent(prev, presetId, getPreset(presetId), slotIndex, contentId));
  }, []);

  const reset = useCallback((presetId) => {
    setConfig((prev) => resetPreset(prev, presetId));
  }, []);

  return { config, assign, reset };
}
