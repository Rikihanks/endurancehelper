import { CELL_CONTENTS, PRESETS } from './liveConfig.js';

export const GRID_CONFIG_KEY = 'inlap-live-grid';
export const GRID_CONFIG_VERSION = 1;

export function emptyGridConfig() {
  return { version: GRID_CONFIG_VERSION, presets: {} };
}

export function getOverrides(config, presetId) {
  const overrides = config && config.presets ? config.presets[presetId] : null;
  return overrides && typeof overrides === 'object' ? overrides : {};
}

export function getCellContents(preset, overrides) {
  return preset.cells.map((cell, index) => {
    const override = overrides[String(index)];
    return CELL_CONTENTS[override] ? override : cell.content;
  });
}

export function getCells(preset, overrides) {
  const contents = getCellContents(preset, overrides);
  return preset.cells.map((cell, index) => ({ ...cell, content: contents[index], slot: index }));
}

function sanitize(presets) {
  const out = {};
  for (const [id, overrides] of Object.entries(presets || {})) {
    const preset = PRESETS[id];
    if (!preset || !overrides || typeof overrides !== 'object') continue;

    const clean = {};
    for (const [slot, content] of Object.entries(overrides)) {
      const index = Number(slot);
      if (Number.isInteger(index) && index >= 0 && index < preset.cells.length && CELL_CONTENTS[content]) {
        clean[slot] = content;
      }
    }

    const contents = getCellContents(preset, clean);
    if (new Set(contents).size === contents.length) out[id] = clean;
  }
  return out;
}

export function readGridConfig(storage) {
  if (!storage || typeof storage.getItem !== 'function') return emptyGridConfig();
  try {
    const raw = storage.getItem(GRID_CONFIG_KEY);
    if (!raw) return emptyGridConfig();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== GRID_CONFIG_VERSION) return emptyGridConfig();
    return { version: GRID_CONFIG_VERSION, presets: sanitize(parsed.presets) };
  } catch (_) {
    return emptyGridConfig();
  }
}

export function writeGridConfig(storage, config) {
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(GRID_CONFIG_KEY, JSON.stringify(config));
  } catch (_) {
    /* storage unavailable */
  }
}

function withPreset(config, presetId, overrides) {
  return { ...config, presets: { ...config.presets, [presetId]: overrides } };
}

export function assignContent(config, presetId, preset, slotIndex, contentId) {
  if (!CELL_CONTENTS[contentId] || slotIndex < 0 || slotIndex >= preset.cells.length) return config;

  const overrides = { ...getOverrides(config, presetId) };
  const contents = getCellContents(preset, overrides);
  const current = contents[slotIndex];
  if (current === contentId) return config;

  const other = contents.indexOf(contentId);
  if (other >= 0) overrides[String(other)] = current;
  overrides[String(slotIndex)] = contentId;

  return withPreset(config, presetId, overrides);
}

export function resetPreset(config, presetId) {
  const presets = { ...config.presets };
  delete presets[presetId];
  return { ...config, presets };
}
