// Run Drizzle versioned migrations against DATABASE_URL.
//   npm run db:migrate
import { initDatabase, closeDatabase } from './client.js';

const dbCtx = await initDatabase();
if (!dbCtx) {
  console.error('[db:migrate] DATABASE_URL is not set.');
  process.exit(1);
}
console.log('[db:migrate] migrations up to date.');
await closeDatabase();
