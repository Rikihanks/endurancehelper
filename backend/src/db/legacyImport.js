import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { users, organizations, memberships, raceConfigs, raceSessions, raceEvents } from './schema.js';

// Deterministic RFC-4122 v5 (SHA-1) UUIDs so the legacy import is idempotent:
// re-running the script never duplicates rows (spec section 11).
const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace
function uuid5(name) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const h = createHash('sha1');
  h.update(ns);
  h.update(Buffer.from(name, 'utf8'));
  const d = h.digest();
  d[6] = (d[6] & 0x0f) | 0x50;
  d[8] = (d[8] & 0x3f) | 0x80;
  const b = d.subarray(0, 16).toString('hex');
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20, 32)}`;
}

function readJson(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`[legacy] cannot read ${file}: ${e.message}`);
  }
  return null;
}

// Import legacy single-tenant data (config.json / qualy.json / last-state.json)
// into PostgreSQL. Does NOT delete the original files. Idempotent.
//
//   config.json     -> race_configs   (upserted, keeps latest payload)
//   qualy.json      -> race_event "qualy_capture" on a legacy session
//   last-state.json -> race_event "last_state" on a legacy session
//
// `db` may be a real drizzle instance or a pg-mem one (tests).
export async function importLegacyData(db, { configFile, qualyFile, stateFile, orgName = 'Legacy import' }) {
  const result = { imported: { config: false, qualy: false, lastState: false } };

  const legacyUserId = uuid5('legacy:user');
  await db
    .insert(users)
    .values({ id: legacyUserId, googleSub: 'legacy:importer', name: 'Legacy importer' })
    .onConflictDoNothing();

  const orgId = uuid5('legacy:org');
  await db
    .insert(organizations)
    .values({ id: orgId, name: orgName, ownerUserId: legacyUserId })
    .onConflictDoNothing();
  await db
    .insert(memberships)
    .values({ userId: legacyUserId, orgId, role: 'owner' })
    .onConflictDoNothing();

  const config = readJson(configFile);
  if (config) {
    const cfgId = uuid5('legacy:race-config');
    await db
      .insert(raceConfigs)
      .values({ id: cfgId, orgId, name: 'Configuración legacy', payloadJson: config })
      .onConflictDoUpdate({ target: raceConfigs.id, set: { payloadJson: config } });
    result.imported.config = true;
  }

  // A deterministic session record to hang qualy + last-state events on.
  const sessionId = uuid5('legacy:session');
  await db
    .insert(raceSessions)
    .values({ id: sessionId, orgId, status: 'stopped', circuitUrl: config?.apex?.circuitUrl || null })
    .onConflictDoNothing();

  const qualy = readJson(qualyFile);
  if (qualy) {
    await db
      .insert(raceEvents)
      .values({ id: uuid5('legacy:qualy-capture'), raceSessionId: sessionId, type: 'qualy_capture', payloadJson: qualy })
      .onConflictDoNothing();
    result.imported.qualy = true;
  }

  const lastState = readJson(stateFile);
  if (lastState) {
    await db
      .insert(raceEvents)
      .values({ id: uuid5('legacy:last-state'), raceSessionId: sessionId, type: 'last_state', payloadJson: lastState })
      .onConflictDoNothing();
    result.imported.lastState = true;
  }

  return { orgId, sessionId, ...result };
}
