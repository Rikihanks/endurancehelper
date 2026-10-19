import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS } from '../src/features/live/liveConfig.js';
import {
  GRID_CONFIG_KEY,
  assignContent,
  emptyGridConfig,
  getCells,
  getOverrides,
  readGridConfig,
  resetPreset,
  writeGridConfig,
} from '../src/features/live/liveGridStore.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

test('defaults come from the preset', () => {
  const cells = getCells(PRESETS.full, {});
  assert.equal(cells.length, 10);
  assert.equal(cells[0].content, 'race_remaining');
  assert.equal(cells[0].slot, 0);
});

test('assigning a content already used swaps the two cells', () => {
  const next = assignContent(emptyGridConfig(), 'full', PRESETS.full, 0, 'position');
  const cells = getCells(PRESETS.full, getOverrides(next, 'full'));
  assert.equal(cells[0].content, 'position');
  assert.equal(cells[1].content, 'race_remaining');
  assert.equal(cells.length, 10);
  assert.equal(new Set(cells.map((cell) => cell.content)).size, 10);
});

test('assigning an unused content just replaces the cell', () => {
  const next = assignContent(emptyGridConfig(), 'focus', PRESETS.focus, 0, 'sectors');
  const cells = getCells(PRESETS.focus, getOverrides(next, 'focus'));
  assert.equal(cells[0].content, 'sectors');
  assert.equal(cells[1].content, 'stint_time');
});

test('assigning the same content keeps the config untouched', () => {
  const config = emptyGridConfig();
  const next = assignContent(config, 'full', PRESETS.full, 0, 'race_remaining');
  assert.equal(next, config);
});

test('edits are isolated per preset', () => {
  const next = assignContent(emptyGridConfig(), 'full', PRESETS.full, 0, 'position');
  assert.deepEqual(getOverrides(next, 'balanced'), {});
  assert.notDeepEqual(getOverrides(next, 'full'), {});
});

test('restoring a preset drops only that preset overrides', () => {
  let config = assignContent(emptyGridConfig(), 'full', PRESETS.full, 0, 'position');
  config = assignContent(config, 'focus', PRESETS.focus, 0, 'sectors');
  const restored = resetPreset(config, 'full');
  assert.deepEqual(getOverrides(restored, 'full'), {});
  assert.notDeepEqual(getOverrides(restored, 'focus'), {});
});

test('config round-trips through storage', () => {
  const storage = fakeStorage();
  const config = assignContent(emptyGridConfig(), 'full', PRESETS.full, 0, 'position');
  writeGridConfig(storage, config);
  const read = readGridConfig(storage);
  const cells = getCells(PRESETS.full, getOverrides(read, 'full'));
  assert.equal(cells[0].content, 'position');
  assert.equal(cells[1].content, 'race_remaining');
});

test('bad JSON, wrong version and unknown content fall back to defaults', () => {
  assert.deepEqual(readGridConfig(fakeStorage()).presets, {});
  assert.deepEqual(readGridConfig(fakeStorage({ [GRID_CONFIG_KEY]: '{oops' })).presets, {});
  assert.deepEqual(
    readGridConfig(fakeStorage({ [GRID_CONFIG_KEY]: JSON.stringify({ version: 99, presets: {} }) })).presets,
    {}
  );
  const bad = fakeStorage({
    [GRID_CONFIG_KEY]: JSON.stringify({ version: 1, presets: { full: { 0: 'nope', 1: 'position' } } }),
  });
  const cells = getCells(PRESETS.full, getOverrides(readGridConfig(bad), 'full'));
  assert.equal(cells[0].content, 'race_remaining');
  assert.equal(cells[1].content, 'position');
});

test('a stored config with duplicates is discarded', () => {
  const dup = fakeStorage({
    [GRID_CONFIG_KEY]: JSON.stringify({
      version: 1,
      presets: { full: { 0: 'position', 1: 'position' } },
    }),
  });
  assert.deepEqual(readGridConfig(dup).presets, {});
});

test('a missing storage is tolerated', () => {
  assert.deepEqual(readGridConfig(null).presets, {});
  writeGridConfig(null, emptyGridConfig());
});
