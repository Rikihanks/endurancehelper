import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApexClient } from './apexClient.js';
import { StrategyEngine } from './strategy.js';
import { QualyStore } from './qualy.js';
import { StateStore } from './stateStore.js';
import { buildView } from './presenter.js';
import { fetchDriverDetails } from './apexApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'sessions');

// Runtime for ONE race session. Owns every piece of race state:
//   config (isolated), strategyEngine, apexClient, qualy/state stores,
//   offlineMode and the background polling timers.
// Two runtimes NEVER share state (Fase 0 acceptance criterion).
export class RaceRuntime {
  constructor({ raceSessionId, orgId, config, hub, dataDir = DEFAULT_DATA_DIR, onLog = console.log }) {
    this.raceSessionId = raceSessionId;
    this.orgId = orgId;
    this.config = config;
    this.hub = hub || { broadcast: () => {} };
    this.onLog = onLog;
    this.offlineMode = false;

    this.dir = path.join(dataDir, String(raceSessionId));
    this.qualyStore = new QualyStore(path.join(this.dir, 'qualy.json'));
    this.stateStore = new StateStore(path.join(this.dir, 'last-state.json'));

    this.strategyEngine = new StrategyEngine(config, this.qualyStore);
    this.apexClient = new ApexClient({
      config,
      onState: () => this.broadcast(),
      onLog: (level, msg) => this.onLog(`[apex:${raceSessionId}] ${msg}`),
    });

    this.telemetry = null; // TelemetryService (attached for Pro orgs only)
    this.timers = [];
  }

  // Attach Pro telemetry persistence (race_laps + race_events).
  attachTelemetry(service) {
    this.telemetry = service;
  }

  // Start background polling of our kart + rivals. Idempotent.
  start() {
    if (this.timers.length) return;
    this.lastSnapshotPos = null;
    this.timers = [
      setInterval(() => this.pollOurKart(), this.config.race.pollLapsMs),
      setInterval(() => this.pollRivals(), this.config.race.pollRivalsMs),
      setInterval(() => this.captureSnapshot(), this.config.race.pollSnapshotsMs || 30000),
    ];
  }

  // Stop timers + disconnect Apex. The runtime object is kept for recovery.
  async stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.telemetry) {
      // Flush any buffered laps/events at race end (spec section 25).
      try {
        await this.telemetry.stop();
      } catch (e) {
        this.onLog(`[telemetry:${this.raceSessionId}] flush error: ${e.message}`);
      }
      this.telemetry = null;
    }
    this.apexClient.disconnect();
  }

  broadcast() {
    this.hub.broadcast(`race:${this.raceSessionId}`, this.getSnapshot());
  }

  // ---- Snapshot with persisted fallback ----
  // Serve the live snapshot when the grid has data; otherwise fall back to the
  // last saved state so the app always has something to display/test.
  getSnapshot() {
    const live = this.strategyEngine.buildSnapshot(this.apexClient.getState());
    const cs = this.apexClient.getState().connectionState || 'idle';
    const connected = cs === 'connected';
    let snap;
    if (this.offlineMode) {
      // Explicit offline mode: intentionally show the last saved snapshot.
      snap = this.stateStore.get() || live;
    } else if (connected) {
      snap = live;
      if ((live.drivers || []).length > 0) this.stateStore.save(live);
    } else {
      // Not connected to any circuit: show a blank/empty state, not stale data.
      snap = live;
    }
    const merged = { ...snap, connected, connectionState: cs, offline: this.offlineMode };
    // Present the display-ready view model so the frontend only renders strings.
    return { ...merged, view: buildView(merged, this.config) };
  }

  async pollOurKart() {
    const state = this.apexClient.getState();
    const our = this.strategyEngine.getOurKartRow(state);
    if (!our) return;
    try {
      const details = await fetchDriverDetails(our.id, { laps: 50, pits: true, best: true, infos: true }, this.config.apex);
      this.strategyEngine.setOurLaps(details.laps);
      this.strategyEngine.setOurPits(details.pits);
      this.strategyEngine.setDriverDetails(our.id, details);
      if (this.telemetry) {
        const gapSec = this.strategyEngine.parseGapSec(our.gap);
        const e = this.strategyEngine.buildEndurance(state);
        const ourLapsArr = this.strategyEngine.ourLaps;
        const currentLap = ourLapsArr.length ? ourLapsArr[ourLapsArr.length - 1].lap : null;
        this.telemetry.recordLaps(our.kart, details.laps, {
          driverId: our.id,
          position: our.position ?? null,
          gapMs: gapSec != null ? Math.round(gapSec * 1000) : null,
        });
        this.telemetry.recordPitStops(our.kart, details.pits, {
          position: our.position ?? null,
          lapsUntilNextStop: e.lapsUntilNextStop ?? null,
          nextStopReason: e.nextStopReason || null,
          plannedStopLap:
            currentLap != null && e.lapsUntilNextStop != null
              ? currentLap + Math.round(e.lapsUntilNextStop)
              : null,
        });
      }
    } catch (e) {
      this.onLog(`[poll:${this.raceSessionId}] our kart: ${e.message}`);
    }
  }

  // Persist one periodic time-series row for the post-race postmortem and log
  // our position changes as events. Runs on a slow timer (default 30s).
  captureSnapshot() {
    if (!this.telemetry) return;
    const state = this.apexClient.getState();
    if (!state.connected || state.mode !== 'race') return;
    const snap = this.strategyEngine.buildSnapshot(state);
    const e = snap.endurance || {};
    const our = snap.ourKart;
    if (!our) return;
    const ourRow = this.strategyEngine.getOurKartRow(state);
    const gapSec = ourRow ? this.strategyEngine.parseGapSec(ourRow.gap) : null;
    this.telemetry.recordSnapshot({
      elapsedMs: e.elapsedMs ?? null,
      kart: our.kart,
      position: our.position ?? null,
      gapLiderMs: gapSec != null ? Math.round(gapSec * 1000) : null,
      virtualPosition: e.virtualPosition ?? null,
      laps: our.laps ?? null,
      stintLaps: our.stintLaps ?? null,
      driverId: our.id || null,
      driverName: e.driverName || our.driver || null,
      avgPaceMs: our.rollingPace || null,
      deltaToTargetMs: e.deltaToTargetMs ?? null,
      traffic: !!e.traffic,
      rivalAheadDeltaMs: e.rivalAhead && e.rivalAhead.delta != null ? Math.round(e.rivalAhead.delta * 1000) : null,
      rivalBehindDeltaMs: e.rivalBehind && e.rivalBehind.delta != null ? Math.round(e.rivalBehind.delta * 1000) : null,
      nextStopReason: e.nextStopReason || null,
      lapsUntilNextStop: e.lapsUntilNextStop ?? null,
      stopsDone: e.stopsDone ?? null,
      payload: {
        lastLapMs: our.lastLap || null,
        bestLapMs: our.bestLap || null,
        remainingMs: e.remainingMs ?? null,
      },
    });

    const pos = our.position;
    if (pos != null && this.lastSnapshotPos != null && pos !== this.lastSnapshotPos) {
      this.telemetry.recordStrategyEvent('position_change', {
        kart: our.kart,
        from: this.lastSnapshotPos,
        to: pos,
        lap: our.laps ?? null,
        driver: e.driverName || our.driver || null,
        elapsedMs: e.elapsedMs ?? null,
      });
    }
    this.lastSnapshotPos = pos;
  }

  async pollRivals() {
    const state = this.apexClient.getState();
    const ourId = this.strategyEngine.getOurKartRow(state)?.id;
    const targets = state.drivers.filter((d) => d.id !== ourId).slice(0, 8);
    for (const d of targets) {
      try {
        const details = await fetchDriverDetails(d.id, { laps: 5, best: true }, this.config.apex);
        this.strategyEngine.setDriverDetails(d.id, details);
      } catch (_) {
        /* skip */
      }
    }
  }
}
