import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatRaceRemaining,
  formatStint,
  formatLap,
  formatDelta,
  formatPosition,
} from '../src/features/live/timeFormat.js';

test('race remaining is HH:MM:SS zero padded', () => {
  assert.equal(formatRaceRemaining(3 * 3600e3 + 15 * 60e3 + 27e3), '03:15:27');
  assert.equal(formatRaceRemaining(0), '00:00:00');
  assert.equal(formatRaceRemaining(null), '--:--:--');
  assert.equal(formatRaceRemaining(-1), '--:--:--');
});

test('stint is MM:SS and keeps minutes above 99', () => {
  assert.equal(formatStint(13 * 60e3 + 57e3), '13:57');
  assert.equal(formatStint(0), '00:00');
  assert.equal(formatStint(105 * 60e3 + 4e3), '105:04');
  assert.equal(formatStint(undefined), '--:--');
});

test('lap is SS:mmm and M:SS:mmm above one minute', () => {
  assert.equal(formatLap(59246), '59:246');
  assert.equal(formatLap(60123), '1:00:123');
  assert.equal(formatLap(83456), '1:23:456');
  assert.equal(formatLap(0), '--:---');
  assert.equal(formatLap(null), '--:---');
});

test('delta has always a sign, two decimals and comma', () => {
  assert.equal(formatDelta(-0.23), '-0,23');
  assert.equal(formatDelta(0.41), '+0,41');
  assert.equal(formatDelta(0), '+0,00');
  assert.equal(formatDelta(null), '--,--');
  assert.equal(formatDelta(undefined), '--,--');
});

test('position is P<n> or --', () => {
  assert.equal(formatPosition(5), 'P5');
  assert.equal(formatPosition(12), 'P12');
  assert.equal(formatPosition(0), '--');
  assert.equal(formatPosition(null), '--');
});
