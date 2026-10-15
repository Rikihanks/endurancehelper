// One-shot importer of legacy single-tenant data (config.json / qualy.json /
// last-state.json) into PostgreSQL. Idempotent; never deletes the originals.
//
//   npm run migrate:legacy
//
// Requires DATABASE_URL to be set.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { importLegacyData } from '../src/db/legacyImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

const dbCtx = await initDatabase();
if (!dbCtx) {
  console.error('[migrate-legacy] DATABASE_URL is not set — cannot import legacy data.');
  process.exit(1);
}

const result = await importLegacyData(dbCtx.db, {
  configFile: path.join(dataDir, 'config.json'),
  qualyFile: path.join(dataDir, 'qualy.json'),
  stateFile: path.join(dataDir, 'last-state.json'),
});

console.log('[migrate-legacy] imported:', JSON.stringify(result.imported, null, 2));
console.log(`[migrate-legacy] orgId=${result.orgId} sessionId=${result.sessionId}`);
await closeDatabase();
