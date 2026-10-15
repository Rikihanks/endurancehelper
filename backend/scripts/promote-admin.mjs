// Promote a user to GLOBAL admin by email (out-of-band bootstrap, no self-service).
//   npm run promote:admin -- you@example.com
import { initDatabase, closeDatabase } from '../src/db/client.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run promote:admin -- <email>');
  process.exit(1);
}

const dbCtx = await initDatabase();
if (!dbCtx) {
  console.error('[promote:admin] DATABASE_URL is not set.');
  process.exit(1);
}

const { makeRepos } = await import('../src/db/repos.js');
const r = makeRepos(dbCtx.db);
const user = await r.findUserByEmail(email);
if (!user) {
  console.error(`[promote:admin] no user with email "${email}".`);
  await closeDatabase();
  process.exit(1);
}
await r.updateUser(user.id, { role: 'admin' });
console.log(`[promote:admin] '${email}' is now a GLOBAL admin.`);
await closeDatabase();
