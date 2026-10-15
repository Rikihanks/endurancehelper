// DEV: wipe ALL data and re-apply migrations from scratch.
//   npm run db:reset
// Drops the public schema (users, orgs, sessions, telemetry, migrations ledger)
// and re-runs every versioned migration. Only run in dev/test.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { initDatabase, closeDatabase } from '../src/db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.join(__dirname, '..', 'src', 'db', 'migrations');

if (process.env.NODE_ENV === 'production') {
  console.error('[db:reset] refusing to reset the production database.');
  process.exit(1);
}

const dbCtx = await initDatabase();
if (!dbCtx) {
  console.error('[db:reset] DATABASE_URL is not set.');
  process.exit(1);
}

// Drizzle records applied migrations in a schema named `drizzle` (NOT public),
// so we must drop BOTH schemas or the migrator would think everything is
// already applied and create nothing.
await dbCtx.pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
console.log('[db:reset] schemas dropped, re-applying migrations...');
await migrate(dbCtx.db, { migrationsFolder: MIGRATIONS_FOLDER });
console.log('[db:reset] done — empty database with migrations applied.');
await closeDatabase();
