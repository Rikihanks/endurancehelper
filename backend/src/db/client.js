import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.join(__dirname, 'migrations');

let instance = null;

// Load .env, then .env.<NODE_ENV> (env-specific overrides) if present.
try { process.loadEnvFile(); } catch (_) { /* no .env file */ }
try {
  if (process.env.NODE_ENV) process.loadEnvFile(`.env.${process.env.NODE_ENV}`);
} catch (_) {
  /* no env-specific file */
}

// Connect to PostgreSQL, apply versioned migrations and return a cached
// { db, pool }. Returns null when DATABASE_URL is not configured (the app then
// keeps working in legacy file mode so development without Docker is possible).
export async function initDatabase() {
  if (instance) return instance;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('[db] DATABASE_URL not set — running without PostgreSQL (legacy file mode).');
    return null;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log('[db] connected + migrations applied');

  instance = { db, pool, schema };
  return instance;
}

export function getDb() {
  return instance ? instance.db : null;
}

export async function closeDatabase() {
  if (instance) {
    await instance.pool.end();
    instance = null;
  }
}
