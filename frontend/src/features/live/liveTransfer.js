function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function applyTransferRule(inLap = {}, raceBox = {}) {
  const inLapCurrent = positive(inLap.currentLap);
  const raceBoxCurrent = positive(raceBox.currentLap);
  const useInLap = inLapCurrent !== null && (raceBoxCurrent === null || inLapCurrent >= raceBoxCurrent);

  const inLapBestMs = positive(inLap.bestLapMs);
  const inLapLastMs = positive(inLap.lastLapMs);
  const inLapLastNumber = positive(inLap.lastLapNumber);

  const raceBoxBestMs = positive(raceBox.bestLapS) !== null ? raceBox.bestLapS * 1000 : null;
  const raceBoxLastMs = positive(raceBox.lastLapS) !== null ? raceBox.lastLapS * 1000 : null;
  const raceBoxBestNumber = positive(raceBox.bestLapNumber);
  const raceBoxLastNumber = positive(raceBox.lastLapNumber);

  let bestLap = null;
  if (useInLap && inLapBestMs !== null) {
    const sameAsRaceBox =
      raceBoxBestMs !== null && Math.abs(inLapBestMs - raceBoxBestMs) <= 2;
    bestLap = {
      timeMs: inLapBestMs,
      lap: sameAsRaceBox ? raceBoxBestNumber : null,
      source: 'inlap',
    };
  } else if (raceBoxBestMs !== null) {
    bestLap = { timeMs: raceBoxBestMs, lap: raceBoxBestNumber, source: 'racebox' };
  }

  let lastLap = null;
  if (useInLap && inLapLastMs !== null && inLapLastNumber !== null) {
    lastLap = { timeMs: inLapLastMs, lap: inLapLastNumber, source: 'inlap' };
  } else if (raceBoxLastMs !== null) {
    lastLap = { timeMs: raceBoxLastMs, lap: raceBoxLastNumber, source: 'racebox' };
  }

  return { bestLap, lastLap, useInLap };
}
