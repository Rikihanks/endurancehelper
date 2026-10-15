import { RaceRuntime } from './raceRuntime.js';

// Owns the live runtimes for all active race sessions: Map<raceSessionId, runtime>.
//
// There is deliberately NO global `config` / `strategyEngine` / `apexClient` in
// the app anymore — a runtime is created per session and each one holds its own
// instances (Fase 0 requirement). `recoverSession` is implemented in Fase 5
// (recreate runtimes from PostgreSQL after a server restart).
export class RaceSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession({ raceSessionId, orgId, config, hub, dataDir }) {
    const runtime = new RaceRuntime({ raceSessionId, orgId, config, hub, dataDir });
    this.sessions.set(raceSessionId, runtime);
    runtime.start();
    return runtime;
  }

  getSession(id) {
    return this.sessions.get(id) || null;
  }

  hasSession(id) {
    return this.sessions.has(id);
  }

  // Stop a single session (timers + Apex + telemetry flush). Other sessions
  // are untouched. Resolves when the runtime is fully stopped.
  async stopSession(id) {
    const runtime = this.sessions.get(id);
    if (!runtime) return false;
    await runtime.stop();
    return true;
  }

  // Stop and fully remove a session.
  async removeSession(id) {
    const runtime = this.sessions.get(id);
    if (!runtime) return false;
    await runtime.stop();
    this.sessions.delete(id);
    return true;
  }

  list() {
    return [...this.sessions.entries()].map(([id, rt]) => ({
      id,
      orgId: rt.orgId,
      status: 'running',
      setupDone: rt.config.race.setupDone === true,
      ourTeamName: rt.config.race.ourTeamName || '',
      ourKart: rt.config.race.ourKart || null,
      connected: rt.apexClient.getState().connectionState === 'connected',
      circuitUrl: rt.config.apex.circuitUrl,
    }));
  }

  async stopAll() {
    for (const id of [...this.sessions.keys()]) await this.removeSession(id);
  }

  // Fase 5: recreate runtimes from persisted race_sessions (status = 'running').
  async recoverSession(/* session */) {
    throw new Error('recoverSession is implemented in Fase 5 (PostgreSQL + race_sessions)');
  }
}
