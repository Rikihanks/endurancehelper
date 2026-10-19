import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTransferRule } from '../src/features/live/liveTransfer.js';

test('InLap wins when its lap is at or ahead of the RaceBox', () => {
  const result = applyTransferRule(
    { currentLap: 10, bestLapMs: 60000, lastLapMs: 60100, lastLapNumber: 9 },
    { currentLap: 10, bestLapS: 59.5, bestLapNumber: 8, lastLapS: 60.5, lastLapNumber: 10 }
  );
  assert.equal(result.useInLap, true);
  assert.equal(result.bestLap.source, 'inlap');
  assert.equal(result.bestLap.timeMs, 60000);
  assert.equal(result.bestLap.lap, null);
  assert.equal(result.lastLap.source, 'inlap');
  assert.equal(result.lastLap.timeMs, 60100);
  assert.equal(result.lastLap.lap, 9);
});

test('RaceBox wins when it is ahead of InLap', () => {
  const result = applyTransferRule(
    { currentLap: 9, bestLapMs: 60000, lastLapMs: 60100, lastLapNumber: 8 },
    { currentLap: 10, bestLapS: 59.5, bestLapNumber: 8, lastLapS: 60.5, lastLapNumber: 10 }
  );
  assert.equal(result.useInLap, false);
  assert.equal(result.bestLap.source, 'racebox');
  assert.equal(result.bestLap.timeMs, 59500);
  assert.equal(result.bestLap.lap, 8);
  assert.equal(result.lastLap.source, 'racebox');
  assert.equal(result.lastLap.timeMs, 60500);
  assert.equal(result.lastLap.lap, 10);
});

test('RaceBox is used while InLap has no data', () => {
  const result = applyTransferRule(
    {},
    { currentLap: 3, bestLapS: 59.5, bestLapNumber: 2, lastLapS: 60.5, lastLapNumber: 3 }
  );
  assert.equal(result.bestLap.source, 'racebox');
  assert.equal(result.lastLap.source, 'racebox');
});

test('InLap falls back to RaceBox per item when a field is missing', () => {
  const result = applyTransferRule(
    { currentLap: 10, lastLapMs: 60100, lastLapNumber: 9 },
    { currentLap: 9, bestLapS: 59.5, bestLapNumber: 8, lastLapS: 60.5, lastLapNumber: 9 }
  );
  assert.equal(result.useInLap, true);
  assert.equal(result.bestLap.source, 'racebox');
  assert.equal(result.lastLap.source, 'inlap');
});

test('the best lap number is borrowed when both sources match', () => {
  const result = applyTransferRule(
    { currentLap: 10, bestLapMs: 59500 },
    { currentLap: 10, bestLapS: 59.5, bestLapNumber: 8 }
  );
  assert.equal(result.bestLap.source, 'inlap');
  assert.equal(result.bestLap.timeMs, 59500);
  assert.equal(result.bestLap.lap, 8);
});

test('nothing is invented without data', () => {
  const result = applyTransferRule({}, {});
  assert.equal(result.bestLap, null);
  assert.equal(result.lastLap, null);
});
