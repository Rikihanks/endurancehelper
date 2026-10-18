// Live lap timing engine: consumes the live RaceBox stream and times laps and
// sectors from a track's traps (Start/Finish + splits), exactly like the
// official apps' "Lap Timer" mode.
//
// Pure and incremental so it can unit test without Bluetooth. Feed it records
// with push(); read state with getSnapshot(); it never renders.

import { crossedTrap } from './RaceBoxTrack.js';

const WEEK_MS = 7 * 24 * 3600 * 1000;

export class LiveTiming {
  constructor(track = null) {
    this._track = null;
    this.reset();
    this.setTrack(track);
  }

  setTrack(track) {
    this._track = track || null;
    this.reset();
  }

  reset() {
    this._prevRecord = null;
    this._prevItow = null;
    this._itowOffset = 0;
    this._lastTimeMs = null;

    this._lapStartMs = null;
    this._sectorStartMs = null;
    this._currentSectors = [];
    this._started = false;

    this.lapNumber = 0;
    /** @type {{durationS:number, sectors:number[]}[]} */
    this.laps = [];
    this.lastLapS = null;
    this.bestLapS = null;
    /** @type {number[]} best time per sector index */
    this.bestSectors = [];
    /** @type {(number|null)[]} */
    this.lastSectors = [];
    this.event = null;
    this.eventAt = 0;
  }

  get sectorCount() {
    return this._track && this._track.startFinish ? (this._track.splits || []).length + 1 : 0;
  }

  get hasStartFinish() {
    return !!(this._track && this._track.startFinish);
  }

  _time(record) {
    const itow = record.iTOW >>> 0;
    if (this._prevItow !== null && itow + this._itowOffset < this._prevItow - WEEK_MS / 2) {
      this._itowOffset += WEEK_MS;
    }
    this._prevItow = itow + this._itowOffset;
    return this._prevItow;
  }

  /**
   * Feed one live record. Returns the crossing event, if any.
   * @returns {{type:'start'|'sector'|'lap', index?:number, timeS?:number, deltaS?:number|null}|null}
   */
  push(record) {
    if (!record) return null;
    const t = this._time(record);
    this._lastTimeMs = t;
    if (this._lapStartMs === null) {
      this._lapStartMs = t;
      this._sectorStartMs = t;
    }
    const prev = this._prevRecord;
    this._prevRecord = record;
    if (!prev || !this.hasStartFinish) return null;

    if (crossedTrap(prev, record, this._track.startFinish)) {
      return this._onStartFinish(t);
    }
    // Splits only count once the timer has started (the entry lap before the
    // first Start/Finish crossing is not split, like the official apps).
    if (this._started) {
      const splits = this._track.splits || [];
      for (let k = 0; k < splits.length; k++) {
        if (crossedTrap(prev, record, splits[k])) {
          return this._onSplit(k, t);
        }
      }
    }
    return null;
  }

  _onStartFinish(t) {
    if (!this._started) {
      this._started = true;
      this._lapStartMs = t;
      this._sectorStartMs = t;
      this._currentSectors = [];
      this.lapNumber = 1;
      this.event = { type: 'start' };
      this.eventAt = Date.now();
      return this.event;
    }

    const finalSector = (t - this._sectorStartMs) / 1000;
    const sectors = [...this._currentSectors, finalSector];
    const durationS = (t - this._lapStartMs) / 1000;

    const lap = { durationS, sectors };
    this.laps.push(lap);
    this.lastLapS = durationS;
    this.lastSectors = sectors.slice();
    sectors.forEach((sec, i) => {
      if (this.bestSectors[i] == null || sec < this.bestSectors[i]) this.bestSectors[i] = sec;
    });
    const delta = this.bestLapS != null ? durationS - this.bestLapS : null;
    if (this.bestLapS == null || durationS < this.bestLapS) this.bestLapS = durationS;

    this.lapNumber += 1;
    this._lapStartMs = t;
    this._sectorStartMs = t;
    this._currentSectors = [];

    this.event = { type: 'lap', timeS: durationS, deltaS: delta };
    this.eventAt = Date.now();
    return this.event;
  }

  _onSplit(k, t) {
    const sectorTime = (t - this._sectorStartMs) / 1000;
    this._currentSectors.push(sectorTime);
    const best = this.bestSectors[k] ?? null;
    const delta = best != null ? sectorTime - best : null;
    if (best == null || sectorTime < best) this.bestSectors[k] = sectorTime;
    this._sectorStartMs = t;

    this.event = { type: 'sector', index: k, timeS: sectorTime, deltaS: delta };
    this.eventAt = Date.now();
    return this.event;
  }

  /** Current lap elapsed time in seconds (live). */
  get currentLapElapsedS() {
    if (this._lapStartMs == null || this._lastTimeMs == null) return 0;
    return Math.max(0, (this._lastTimeMs - this._lapStartMs) / 1000);
  }

  /** Best possible lap from the best sectors seen so far. */
  get optimalLapS() {
    const count = this.sectorCount;
    if (this.laps.length < 2 || count === 0) return null;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const v = this.bestSectors[i];
      if (v == null) return null;
      sum += v;
    }
    return sum;
  }

  getSnapshot() {
    return {
      trackName: this._track ? this._track.name : null,
      started: this._started,
      lapNumber: this.lapNumber,
      laps: this.laps.length,
      currentLapElapsedS: this.currentLapElapsedS,
      lastLapS: this.lastLapS,
      bestLapS: this.bestLapS,
      optimalLapS: this.optimalLapS,
      sectorCount: this.sectorCount,
      bestSectors: this.bestSectors.slice(),
      lastSectors: this.lastSectors.slice(),
      currentSectors: this._currentSectors.slice(),
      event: this.event,
      eventAt: this.eventAt,
    };
  }
}
