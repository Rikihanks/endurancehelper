import { applyTransferRule } from './liveTransfer.js';

const MIN = 60e3;

export function getStintColor(elapsedMs, maxMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'muted';

  if (Number.isFinite(maxMs) && maxMs > 0) {
    const remaining = maxMs - elapsedMs;
    if (remaining <= 5 * MIN) return 'red';
    if (remaining <= 10 * MIN) return 'orange';
  }

  if (elapsedMs < 5 * MIN) return 'black';
  return 'green';
}

export function computeSectorStates(current, previous, best, count = 0) {
  const cur = Array.isArray(current) ? current : [];
  const prev = Array.isArray(previous) ? previous : [];
  const bst = Array.isArray(best) ? best : [];
  const length = Math.max(count || 0, cur.length, prev.length, bst.length);
  if (!length) return [];

  const out = [];
  for (let i = 0; i < length; i += 1) {
    const curMs = cur[i];
    if (!Number.isFinite(curMs) || curMs <= 0) {
      out.push('empty');
      continue;
    }

    const bestMs = bst[i];
    const prevMs = prev[i];
    const hasBest = Number.isFinite(bestMs) && bestMs > 0;
    const hasPrev = Number.isFinite(prevMs) && prevMs > 0;

    if (hasBest && curMs <= bestMs) {
      out.push('best');
    } else if (hasPrev) {
      out.push(curMs <= prevMs ? 'improved' : 'slower');
    } else {
      out.push('best');
    }
  }
  return out;
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function rivalAt(drivers, position) {
  if (!Number.isFinite(position)) return null;
  const row = drivers.find((driver) => driver.position === position);
  if (!row) return null;
  return {
    position: row.position,
    lastLapMs: positive(row.lastLap),
  };
}

export function selectSource({ hasInLap = false, simulating = false, hasRaceBox = false, isDev = false } = {}) {
  if (hasInLap) return 'inlap';
  if (simulating) return 'sim';
  if (hasRaceBox) return 'racebox';
  return isDev ? 'mock' : 'none';
}

export function selectModel(source, { inLapModel, raceBoxModel, mockModel, emptyModel }) {
  if (source === 'inlap') return inLapModel;
  if (source === 'racebox' || source === 'sim') return raceBoxModel;
  if (source === 'mock') return mockModel;
  return emptyModel;
}

export function buildLiveScreenModel(payload, racebox = null) {
  if (!payload || typeof payload !== 'object') return null;

  const ourKart = payload.ourKart || null;
  const endurance = payload.endurance || {};
  const drivers = Array.isArray(payload.drivers) ? payload.drivers : [];
  const rb = racebox || null;

  const position = positive(ourKart && ourKart.position);
  const driversByPos = drivers.filter((driver) => positive(driver.position));

  const stintMaxMs = positive(endurance.stintMaxMin) ? endurance.stintMaxMin * MIN : null;
  const stintElapsedMs = null;
  const stintTone = getStintColor(stintElapsedMs, stintMaxMs);

  const deltaSeconds = rb && Number.isFinite(rb.deltaSeconds) ? rb.deltaSeconds : null;
  const deltaTone = deltaSeconds === null ? 'muted' : deltaSeconds < 0 ? 'green' : deltaSeconds > 0 ? 'red' : 'muted';

  const laps = Number.isFinite(ourKart && ourKart.laps) && ourKart.laps >= 0 ? ourKart.laps : null;
  const inLapCurrent = laps === null ? null : laps + 1;

  const transfer = applyTransferRule(
    {
      currentLap: inLapCurrent,
      bestLapMs: positive(ourKart && ourKart.bestLap),
      lastLapMs: positive(ourKart && ourKart.lastLap),
      lastLapNumber: laps ? laps : null,
    },
    {
      currentLap: rb && positive(rb.currentLap),
      bestLapS: rb && rb.bestLapS,
      bestLapNumber: rb && rb.bestLapNumber,
      lastLapS: rb && rb.lastLapS,
      lastLapNumber: rb && rb.lastLapNumber,
    }
  );

  const sectors = rb
    ? computeSectorStates(rb.currentSectors, rb.lastSectors, rb.bestSectors, rb.sectorCount)
    : [];

  return {
    isMock: false,
    hasData: !!(ourKart || payload.endurance),
    raceRemainingMs: Number.isFinite(endurance.remainingMs) ? Math.max(0, endurance.remainingMs) : null,
    position,
    targetLapMs: positive(endurance.targetLapMs),
    stintElapsedMs,
    stintMaxMs,
    stintTone,
    stintPending: true,
    rivalAhead: rivalAt(driversByPos, position ? position - 1 : null),
    rivalBehind: rivalAt(driversByPos, position ? position + 1 : null),
    currentLap: inLapCurrent !== null ? inLapCurrent : rb && positive(rb.currentLap),
    deltaSeconds,
    deltaTone,
    sectors,
    bestLap: transfer.bestLap || { lap: null, timeMs: null },
    lastLap: transfer.lastLap || { lap: null, timeMs: null },
    connected: !!payload.connected,
    connectionState: payload.connectionState || 'idle',
    kart: (ourKart && ourKart.kart) || null,
  };
}
