import { mergeConfigPayload } from '../config.js';
import { attachTelemetry } from './telemetry/service.js';

// Recovery after a server restart (spec section 23).
//
// For every race_session with status='running' we recreate a runtime
// (StrategyEngine + ApexClient), optionally reconnecting to Apex. Sessions that
// fail to recover are marked 'recovering' (never 'finished') and logged.
export async function recoverRunningSessions({ repos, manager, hub, connect = false, onLog = console.log }) {
  const running = await repos.listRunningSessions();
  for (const session of running) {
    try {
      const config = mergeConfigPayload(session.configJson);
      manager.createSession({ raceSessionId: session.id, orgId: session.orgId, config, hub });
      const rt = manager.getSession(session.id);
      if (connect && config.apex?.circuitUrl) rt.apexClient.connect();
      attachTelemetry({ rt, repos });
      onLog(`[recover] resumed race session ${session.id}`);
    } catch (e) {
      onLog(`[recover] session ${session.id} failed: ${e.message}`);
      try {
        await repos.setRaceSessionStatus(session.orgId, session.id, 'recovering');
      } catch (_) {
        /* already failed to recover */
      }
    }
  }
  return running.length;
}
