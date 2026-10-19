import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL_CONTENTS, PRESETS, PRESET_ORDER } from '../src/features/live/liveConfig.js';

function overlaps(a, b) {
  return a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;
}

test('every preset is well formed and stays inside its half', () => {
  for (const id of PRESET_ORDER) {
    const preset = PRESETS[id];
    assert.ok(preset, `missing preset ${id}`);
    assert.equal(preset.id, id);
    assert.ok(Array.isArray(preset.cells) && preset.cells.length > 0);

    const contents = new Set();
    for (const cell of preset.cells) {
      assert.ok(CELL_CONTENTS[cell.content], `${id}: unknown content ${cell.content}`);
      assert.ok(!contents.has(cell.content), `${id}: duplicated content ${cell.content}`);
      contents.add(cell.content);

      assert.ok(Number.isInteger(cell.c) && cell.c >= 0, `${id}: bad c`);
      assert.ok(Number.isInteger(cell.r) && cell.r >= 0, `${id}: bad r`);
      assert.ok(Number.isInteger(cell.w) && cell.w > 0, `${id}: bad w`);
      assert.ok(Number.isInteger(cell.h) && cell.h > 0, `${id}: bad h`);

      assert.ok(cell.c + cell.w <= 12, `${id}: ${cell.content} exceeds 12 columns`);
      assert.ok(cell.r + cell.h <= 9, `${id}: ${cell.content} exceeds 9 rows`);
      assert.ok(
        cell.c < 6 ? cell.c + cell.w <= 6 : cell.c >= 6,
        `${id}: ${cell.content} crosses column 6`
      );
    }

    for (let i = 0; i < preset.cells.length; i += 1) {
      for (let j = i + 1; j < preset.cells.length; j += 1) {
        assert.ok(!overlaps(preset.cells[i], preset.cells[j]), `${id}: overlapping cells`);
      }
    }
  }
});

test('preset cell counts match the design', () => {
  assert.equal(PRESETS.full.cells.length, 10);
  assert.equal(PRESETS.balanced.cells.length, 6);
  assert.equal(PRESETS.essential.cells.length, 4);
  assert.equal(PRESETS.focus.cells.length, 2);
  assert.deepEqual(PRESET_ORDER, ['full', 'balanced', 'essential', 'focus']);
});
