import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getStintColor,
  computeSectorStates,
  buildLiveScreenModel,
  selectSource,
  selectModel,
} from '../src/features/live/liveModel.js';

const MIN = 60e3;
const MAX40 = 40 * MIN;

test('stint colour thresholds and priority', () => {
  assert.equal(getStintColor(0, MAX40), 'black');
  assert.equal(getStintColor(4 * MIN + 59e3, MAX40), 'black');
  assert.equal(getStintColor(5 * MIN, MAX40), 'green');
  assert.equal(getStintColor(29 * MIN, MAX40), 'green');
  assert.equal(getStintColor(30 * MIN, MAX40), 'orange');
  assert.equal(getStintColor(35 * MIN, MAX40), 'red');
  assert.equal(getStintColor(39 * MIN, MAX40), 'red');
});

test('stint colour without max only uses black and green', () => {
  assert.equal(getStintColor(4 * MIN, null), 'black');
  assert.equal(getStintColor(6 * MIN, null), 'green');
  assert.equal(getStintColor(6 * MIN, 0), 'green');
  assert.equal(getStintColor(60 * MIN, undefined), 'green');
});

test('stint colour is muted when elapsed is unknown', () => {
  assert.equal(getStintColor(null, MAX40), 'muted');
  assert.equal(getStintColor(undefined, MAX40), 'muted');
  assert.equal(getStintColor(-1, MAX40), 'muted');
});

test('red outranks black, orange and green', () => {
  assert.equal(getStintColor(4 * MIN, 8 * MIN), 'red');
  assert.equal(getStintColor(4 * MIN, 12 * MIN), 'orange');
});

test('sectors: no configured sectors yields an empty list', () => {
  assert.deepEqual(computeSectorStates([], [], [], 0), []);
  assert.deepEqual(computeSectorStates(null, null, null, 0), []);
});

test('sectors: first completion with no reference is the session best', () => {
  assert.deepEqual(computeSectorStates([10000], [], [], 0), ['best']);
  assert.deepEqual(computeSectorStates([10000], [], [], 3), ['best', 'empty', 'empty']);
});

test('sectors: best, improved and slower', () => {
  assert.deepEqual(computeSectorStates([8000], [9000], [8500], 0), ['best']);
  assert.deepEqual(computeSectorStates([10000], [10500], [9000], 0), ['improved']);
  assert.deepEqual(computeSectorStates([11000], [10500], [9000], 0), ['slower']);
});

test('sectors: matching the previous lap is not slower', () => {
  assert.deepEqual(computeSectorStates([10500], [10500], [9000], 0), ['improved']);
});

test('sectors: incomplete sectors stay grey', () => {
  assert.deepEqual(
    computeSectorStates([null, 9000, null], [10000, 10000, 10000], [9000, 9000, 9000], 0),
    ['empty', 'best', 'empty']
  );
});

test('sectors: circuit sector count pads with grey segments', () => {
  assert.deepEqual(computeSectorStates([10000], [], [], 4), ['best', 'empty', 'empty', 'empty']);
});

const SNAPSHOT = {
  connected: true,
  connectionState: 'connected',
  track: 'KOTARR (2250m)',
  ourKart: {
    id: 'r136',
    position: 2,
    laps: 8,
    bestLap: 63777,
    lastLap: 63777,
  },
  drivers: [
    { id: 'r137', position: 1, lastLap: 50946, bestLap: 50946 },
    { id: 'r136', position: 2, lastLap: 63777, bestLap: 63777 },
    { id: 'r138', position: 3, lastLap: 60000, bestLap: 59000 },
  ],
  endurance: {
    remainingMs: 7200000,
    targetLapMs: 63777,
    stintMaxMin: 40,
  },
};

test('live model maps the InLap snapshot without inventing fields', () => {
  const model = buildLiveScreenModel(SNAPSHOT);
  assert.equal(model.hasData, true);
  assert.equal(model.raceRemainingMs, 7200000);
  assert.equal(model.position, 2);
  assert.equal(model.targetLapMs, 63777);
  assert.equal(model.currentLap, 9);
  assert.equal(model.lastLap.lap, 8);
  assert.equal(model.lastLap.timeMs, 63777);
  assert.equal(model.bestLap.lap, null);
  assert.equal(model.bestLap.timeMs, 63777);
  assert.deepEqual(model.rivalAhead, { position: 1, lastLapMs: 50946 });
  assert.deepEqual(model.rivalBehind, { position: 3, lastLapMs: 60000 });
  assert.equal(model.stintElapsedMs, null);
  assert.equal(model.stintMaxMs, 40 * MIN);
  assert.equal(model.stintTone, 'muted');
  assert.equal(model.stintPending, true);
  assert.equal(model.deltaSeconds, null);
  assert.equal(model.deltaTone, 'muted');
  assert.deepEqual(model.sectors, []);
});

test('live model handles first and last position', () => {
  const first = buildLiveScreenModel({ ...SNAPSHOT, ourKart: { ...SNAPSHOT.ourKart, position: 1 } });
  assert.equal(first.rivalAhead, null);
  assert.equal(first.rivalBehind.position, 2);

  const last = buildLiveScreenModel({ ...SNAPSHOT, ourKart: { ...SNAPSHOT.ourKart, position: 3 } });
  assert.equal(last.rivalAhead.position, 2);
  assert.equal(last.rivalBehind, null);
});

test('live model builds sector tones and passes the racebox delta', () => {
  const model = buildLiveScreenModel(SNAPSHOT, {
    deltaSeconds: -0.23,
    currentSectors: [12, 11, 10],
    lastSectors: [11, 11, 9],
    bestSectors: [10, 10, 9],
    sectorCount: 3,
  });
  assert.equal(model.deltaSeconds, -0.23);
  assert.equal(model.deltaTone, 'green');
  assert.deepEqual(model.sectors, ['slower', 'improved', 'slower']);
  assert.equal(buildLiveScreenModel(SNAPSHOT, { deltaSeconds: 0.41 }).deltaTone, 'red');
});

test('live model keeps zero remaining time and lap 1 before any completed lap', () => {
  const model = buildLiveScreenModel({
    ...SNAPSHOT,
    ourKart: { ...SNAPSHOT.ourKart, laps: 0, lastLap: 0, bestLap: 0 },
    endurance: { ...SNAPSHOT.endurance, remainingMs: 0 },
  });
  assert.equal(model.raceRemainingMs, 0);
  assert.equal(model.currentLap, 1);
  assert.equal(model.lastLap.lap, null);
  assert.equal(model.lastLap.timeMs, null);
  assert.equal(model.bestLap.timeMs, null);
});

test('racebox-only model fills delta, sectors and laps without InLap', () => {
  const model = buildLiveScreenModel({}, {
    currentLap: 4,
    laps: 3,
    deltaSeconds: -0.4,
    currentSectors: [10],
    lastSectors: [11, 12, 13],
    bestSectors: [10, 12, 13],
    sectorCount: 3,
    bestLapS: 20.5,
    bestLapNumber: 2,
    lastLapS: 20.8,
    lastLapNumber: 3,
  });
  assert.equal(model.hasData, false);
  assert.equal(model.currentLap, 4);
  assert.equal(model.deltaSeconds, -0.4);
  assert.equal(model.deltaTone, 'green');
  assert.deepEqual(model.sectors, ['best', 'empty', 'empty']);
  assert.equal(model.bestLap.source, 'racebox');
  assert.equal(model.bestLap.lap, 2);
  assert.equal(model.bestLap.timeMs, 20500);
  assert.equal(model.lastLap.source, 'racebox');
  assert.equal(model.lastLap.lap, 3);
  assert.equal(model.lastLap.timeMs, 20800);
  assert.equal(model.position, null);
});

test('source selection prefers InLap, then simulation, then RaceBox', () => {
  assert.equal(selectSource({ hasInLap: true, simulating: true, hasRaceBox: true, isDev: true }), 'inlap');
  assert.equal(selectSource({ simulating: true, hasRaceBox: true, isDev: true }), 'sim');
  assert.equal(selectSource({ hasRaceBox: true, isDev: true }), 'racebox');
  assert.equal(selectSource({ isDev: true }), 'mock');
  assert.equal(selectSource({ isDev: false }), 'none');
});

test('simulation and RaceBox both use the RaceBox model', () => {
  const models = {
    inLapModel: { id: 'inlap' },
    raceBoxModel: { id: 'racebox' },
    mockModel: { id: 'mock' },
    emptyModel: { id: 'empty' },
  };
  assert.equal(selectModel('inlap', models).id, 'inlap');
  assert.equal(selectModel('sim', models).id, 'racebox');
  assert.equal(selectModel('racebox', models).id, 'racebox');
  assert.equal(selectModel('mock', models).id, 'mock');
  assert.equal(selectModel('none', models).id, 'empty');
});

test('live model returns null without a payload', () => {
  assert.equal(buildLiveScreenModel(null), null);
  assert.equal(buildLiveScreenModel(undefined), null);
});
