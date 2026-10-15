import express from 'express';
import { appError, toErrorBody } from '../errors.js';
import { mergeConfigPayload } from '../../config.js';
import { resolveCircuit } from '../apexApi.js';
import { attachTelemetry } from '../telemetry/service.js';
import { buildRaceReport } from '../telemetry/report.js';

// DB-backed race sessions (spec sections 7, 22-23). Protected at mount time
// with requireAuth + requireActiveLicense; every query is org-scoped.
//
// Starting a race SNAPSHOTS the config (configJson): later edits to the
// original race_config never change an already started race. Telemetry
// (race_laps + race_events) is persisted for every session.
export function createRaceSessionsRouter({ repos, manager, hub, resolveOnStart = true }) {
  const router = express.Router();

  function handle(res, fn) {
    return fn()
      .then((data) => res.json(data))
      .catch((e) => {
        res.status(e.status || 500).json(toErrorBody(e));
      });
  }

  const present = (s) => {
    const rt = manager.getSession(s.id);
    const connected = !!(rt && rt.apexClient.getState().connectionState === 'connected');
    return {
      id: s.id,
      orgId: s.orgId,
      raceConfigId: s.raceConfigId,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      circuitUrl: s.circuitUrl,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      // "En directo" only when the runtime is actually receiving live data.
      live: s.status === 'running' && connected,
    };
  };

  router.get('/', (req, res) =>
    handle(res, async () => {
      const sessions = await repos.listRaceSessions(req.user.orgId);
      return { sessions: sessions.map(present) };
    })
  );

  // POST /api/race-sessions { raceConfigId } — snapshot config + start runtime.
  router.post('/', (req, res) =>
    handle(res, async () => {
      const { raceConfigId } = req.body || {};
      if (!raceConfigId) throw appError('VALIDATION_ERROR', 'raceConfigId is required');
      const cfg = await repos.getRaceConfig(req.user.orgId, raceConfigId);
      if (!cfg) throw appError('RESOURCE_NOT_FOUND', 'Race config not found');

      // Freeze the config for THIS race (spec section 22).
      const frozen = mergeConfigPayload(cfg.payloadJson);

      // If the config carries a circuit URL, resolve its real host/ports and
      // connect the Apex client right away (like the legacy /api/setup flow).
      let connected = false;
      if (resolveOnStart && frozen.apex?.circuitUrl) {
        try {
          const resolved = await resolveCircuit(frozen.apex.circuitUrl);
          Object.assign(frozen.apex, resolved);
          connected = true;
        } catch (e) {
          console.log(`[race-session] circuit resolve failed for ${frozen.apex.circuitUrl}: ${e.message}`);
        }
      }

      const session = await repos.createRaceSession({
        orgId: req.user.orgId,
        raceConfigId: cfg.id,
        status: 'running',
        startedAt: new Date(),
        circuitUrl: frozen.apex.circuitUrl || null,
        configJson: frozen, // resolved config, so recovery can reconnect too
      });

      const rt = manager.createSession({ raceSessionId: session.id, orgId: req.user.orgId, config: frozen, hub });
      if (connected) rt.apexClient.connect();
      attachTelemetry({ rt, repos });
      return { session: present(session) };
    })
  );

  router.get('/:id', (req, res) =>
    handle(res, async () => {
      const session = await repos.getRaceSession(req.user.orgId, req.params.id);
      if (!session) throw appError('RESOURCE_NOT_FOUND', 'Race session not found');
      return { session: present(session) };
    })
  );

  router.get('/:id/state', (req, res) =>
    handle(res, async () => {
      const session = await repos.getRaceSession(req.user.orgId, req.params.id);
      if (!session) throw appError('RESOURCE_NOT_FOUND', 'Race session not found');
      const rt = manager.getSession(session.id);
      if (!rt) throw appError('RESOURCE_NOT_FOUND', 'Race session runtime not active');
      return rt.getSnapshot();
    })
  );

  // POST /api/race-sessions/:id/finish — stop the runtime and mark the race
  // as finished (keeps it for the report).
  router.post('/:id/finish', (req, res) =>
    handle(res, async () => {
      const session = await repos.getRaceSession(req.user.orgId, req.params.id);
      if (!session) throw appError('RESOURCE_NOT_FOUND', 'Race session not found');
      await manager.removeSession(session.id);
      hub.disconnectOrgEsp32(req.user.orgId);
      const ended = await repos.updateRaceSession(req.user.orgId, session.id, { status: 'finished', endedAt: new Date() });
      return { ok: true, session: present(ended) };
    })
  );

  router.delete('/:id', (req, res) =>
    handle(res, async () => {
      const session = await repos.getRaceSession(req.user.orgId, req.params.id);
      if (!session) throw appError('RESOURCE_NOT_FOUND', 'Race session not found');
      // Stop runtime first (timers + Apex + telemetry flush), then hard delete.
      await manager.removeSession(session.id);
      await repos.deleteRaceSessionById(session.id); // cascades race_laps + race_events
      return { ok: true };
    })
  );

  // GET /api/race-sessions/:id/report — post-race analysis (available to all
  // active licenses; the route itself requires requireActiveLicense).
  router.get('/:id/report', (req, res) =>
    handle(res, async () => {
      const session = await repos.getRaceSession(req.user.orgId, req.params.id);
      if (!session) throw appError('RESOURCE_NOT_FOUND', 'Race session not found');
      const report = await buildRaceReport(repos, session);
      return { report };
    })
  );

  return router;
}
