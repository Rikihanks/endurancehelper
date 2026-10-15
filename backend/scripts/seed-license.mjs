// Seed a trial license directly in PostgreSQL (for dev/testing).
//
//   npm run seed:license
//
// Creates (if missing) the "test-org" organization with an owner user and an
// active license. The `plan` column stores the billing interval. Idempotent.
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { makeRepos } from '../src/db/repos.js';

const dbCtx = await initDatabase();
if (!dbCtx) {
  console.error('[seed:license] DATABASE_URL is not set.');
  process.exit(1);
}

const repos = makeRepos(dbCtx.db);
const orgName = process.env.ORG_NAME || 'test-org';
const interval = process.env.SEED_INTERVAL || 'annual';
const seats = Number(process.env.SEED_SEATS || 5);

if (!['monthly', 'annual'].includes(interval)) {
  console.error(`[seed:license] invalid SEED_INTERVAL '${interval}' (monthly | annual)`);
  process.exit(1);
}

// Find the org by name.
import { eq } from 'drizzle-orm';
const { organizations } = await import('../src/db/schema.js');
const existing = await dbCtx.db
  .select()
  .from(organizations)
  .where(eq(organizations.name, orgName))
  .limit(1)
  .then((r) => r[0] || null);

let org = existing;
if (!org) {
  const owner = await repos.createUser({ googleSub: `seed:${orgName}`, name: `Seed ${orgName}` });
  org = await repos.createOrganization({ name: orgName, ownerUserId: owner.id });
  await repos.createMembership({ userId: owner.id, orgId: org.id, role: 'owner' });
  console.log(`[seed:license] created org "${orgName}" (${org.id})`);
} else {
  console.log(`[seed:license] using existing org "${orgName}" (${org.id})`);
}

const existingLicense = await repos.getLicenseByOrgId(org.id);
if (existingLicense) {
  console.log(`[seed:license] license already exists (${existingLicense.plan}/${existingLicense.status}). Nothing to do.`);
} else {
  await repos.createLicense({ orgId: org.id, plan: interval, seats, status: 'active' });
  console.log(`[seed:license] created license interval=${interval} status=active seats=${seats}`);
}

await closeDatabase();
