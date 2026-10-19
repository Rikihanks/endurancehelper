import { LiveTiming } from './RaceBoxLiveTiming.js';
import { lapDistanceM } from './RaceBoxTrack.js';
import { haversine, resampleLapByDistance } from './RaceBoxAnalysis.js';

export class RaceBoxLiveBridge {
  constructor(track = null) {
    this.track = track || null;
    this.engine = new LiveTiming(this.track);
    this.records = [];
    this.lapStartIndex = 0;
    this.lapStartDistanceM = 0;
    this.totalDistanceM = 0;
    this.bestTrace = null;
    this.bestLapNumber = null;
    this.lastLapNumber = null;
  }

  push(record) {
    if (!record) return null;
    const previous = this.records[this.records.length - 1];
    const index = this.records.length;
    this.records.push(record);

    if (previous) {
      this.totalDistanceM += haversine(
        previous.latitude,
        previous.longitude,
        record.latitude,
        record.longitude
      );
    }

    const previousBest = this.engine.bestLapS;
    const event = this.engine.push(record);
    if (!event) return null;

    if (event.type === 'start') {
      this.lapStartIndex = index;
      this.lapStartDistanceM = this.totalDistanceM;
      this.bestTrace = null;
      this.bestLapNumber = null;
      this.lastLapNumber = null;
      return event;
    }

    if (event.type === 'lap') {
      const completedLap = this.engine.lapNumber - 1;
      const lap = {
        startIndex: this.lapStartIndex,
        endIndex: index,
        distanceM: 0,
      };
      lap.distanceM = lapDistanceM(this.records, lap);
      this.lastLapNumber = completedLap;

      if (previousBest === null || event.timeS < previousBest) {
        this.bestLapNumber = completedLap;
        this.bestTrace = resampleLapByDistance(this.records, lap);
      }

      this.lapStartIndex = index;
      this.lapStartDistanceM = this.totalDistanceM;
    }

    return event;
  }

  get deltaSeconds() {
    if (!this.bestTrace || !this.bestTrace.distances.length) return null;
    if (this.engine.lapNumber <= 0) return null;

    const currentDistance = this.totalDistanceM - this.lapStartDistanceM;
    if (!Number.isFinite(currentDistance) || currentDistance < 0) return null;

    const { distances, times } = this.bestTrace;
    const last = distances.length - 1;
    if (currentDistance >= distances[last]) {
      return this.engine.currentLapElapsedS - times[last];
    }

    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (distances[mid] <= currentDistance) lo = mid;
      else hi = mid - 1;
    }

    const next = Math.min(lo + 1, last);
    const span = distances[next] - distances[lo];
    const t = span > 0 ? (currentDistance - distances[lo]) / span : 0;
    const referenceTime = times[lo] + (times[next] - times[lo]) * t;
    return this.engine.currentLapElapsedS - referenceTime;
  }

  getContext() {
    const snapshot = this.engine.getSnapshot();
    return {
      trackName: snapshot.trackName,
      started: snapshot.started,
      currentLap: snapshot.lapNumber,
      laps: snapshot.laps,
      currentLapElapsedS: snapshot.currentLapElapsedS,
      lastLapS: snapshot.lastLapS,
      lastLapNumber: this.lastLapNumber,
      bestLapS: snapshot.bestLapS,
      bestLapNumber: this.bestLapNumber,
      deltaSeconds: this.deltaSeconds,
      sectorCount: snapshot.sectorCount,
      currentSectors: snapshot.currentSectors,
      lastSectors: snapshot.lastSectors,
      bestSectors: snapshot.bestSectors,
    };
  }
}
