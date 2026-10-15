// TelemetryService persists race_laps + race_events for EVERY race (there is
// no feature tier anymore — analysis is available to all paying orgs).
// StrategyEngine never talks to PostgreSQL — the chain is:
//
//   ApexClient -> RaceRuntime -> TelemetryService -> repos -> PostgreSQL
//
// Laps/events are buffered in memory and flushed in BATCHES to avoid an INSERT
// per event; the buffer is always flushed on stop.
export class TelemetryService {
  constructor({ repos, raceSessionId, orgId, flushMs = 5000 }) {
    this.repos = repos;
    this.raceSessionId = raceSessionId;
    this.orgId = orgId;
    this.flushMs = flushMs;
    this.buffer = { laps: [], events: [], snapshots: [] };
    this.seenLaps = new Set();    // `${kart}:${lap}`
    this.seenEvents = new Set();  // `${type}:${key}`
    this.timer = null;
    this.stopped = false;
  }

  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { this.flush().catch(() => {}); }, this.flushMs);
  }

  // Flush the buffer (also called on stop so nothing is lost at race end).
  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  recordLaps(kart, laps, ctx = {}) {
    if (this.stopped || !Array.isArray(laps)) return;
    let first = true;
    for (const l of laps) {
      if (!l || typeof l.lap !== 'number') continue;
      const key = `${kart}:${l.lap}`;
      if (this.seenLaps.has(key)) continue;
      this.seenLaps.add(key);
      if (first && !this.seenEvents.has('race_start')) {
        this.recordEvent('race_start', { kart, lap: l.lap });
      }
      first = false;
      this.buffer.laps.push({
        raceSessionId: this.raceSessionId,
        kart: String(kart),
        lapNumber: l.lap,
        lapTimeMs: l.total > 0 ? l.total : null,
        sectorTimes: { s1: l.s1 || 0, s2: l.s2 || 0, s3: l.s3 || 0 },
        driverId: ctx.driverId || null,
        position: ctx.position ?? null,
        gapLiderMs: ctx.gapMs ?? null,
        timestamp: new Date(),
      });
    }
  }

  recordPitStops(kart, pits, ctx = {}) {
    if (this.stopped || !Array.isArray(pits)) return;
    for (const p of pits) {
      if (!p || typeof p.pit !== 'number') continue;
      // Dedupe by the physical stop (kart + pit number), NOT the payload: the
      // strategy context changes between polls and would otherwise duplicate it.
      const key = `pit_stop:${kart}:${p.pit}`;
      if (this.seenEvents.has(key)) continue;
      this.seenEvents.add(key);
      this.recordEvent('pit_stop', {
        kart: String(kart),
        pitNumber: p.pit,
        lap: p.lap,
        pitTimeMs: p.pitTime > 0 ? p.pitTime : null,
        driverId: p.pitDriverId || null,
        // strategy context captured when the stop was first seen
        position: ctx.position ?? null,
        plannedLapsUntilStop: ctx.lapsUntilNextStop ?? null,
        plannedReason: ctx.nextStopReason || null,
        plannedStopLap: ctx.plannedStopLap ?? null,
      });
    }
  }

  // Periodic time-series row for the post-race postmortem (position, pace,
  // virtual position and the strategy recommendation at that moment).
  recordSnapshot(data) {
    if (this.stopped) return;
    this.buffer.snapshots.push({
      raceSessionId: this.raceSessionId,
      timestamp: new Date(),
      ...data,
    });
  }

  // A one-off strategic event (position change, condition change, etc).
  recordStrategyEvent(type, payload) {
    this.recordEvent(type, payload);
  }

  recordEvent(type, payload) {
    if (this.stopped) return;
    const key = `${type}:${JSON.stringify(payload)}`;
    if (this.seenEvents.has(key)) return;
    this.seenEvents.add(key);
    this.buffer.events.push({
      raceSessionId: this.raceSessionId,
      type,
      payloadJson: payload,
      timestamp: new Date(),
    });
  }

  async flush() {
    const laps = this.buffer.laps.splice(0);
    const events = this.buffer.events.splice(0);
    const snapshots = this.buffer.snapshots.splice(0);
    const inserted = { laps: 0, events: 0, snapshots: 0 };
    if (laps.length) inserted.laps = await this.repos.insertRaceLaps(laps);
    if (events.length) inserted.events = await this.repos.insertRaceEvents(events);
    if (snapshots.length) inserted.snapshots = await this.repos.insertRaceSnapshots(snapshots);
    return inserted;
  }
}

// Attach telemetry to a running race. Available to every active race session
// (the routes that start races already require an active license).
export function attachTelemetry({ rt, repos }) {
  const service = new TelemetryService({ repos, raceSessionId: rt.raceSessionId, orgId: rt.orgId });
  rt.attachTelemetry(service);
  service.start();
  return service;
}
