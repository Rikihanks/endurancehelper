import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemDb } from './helpers/pgmem.js';
import { makeRepos } from '../src/db/repos.js';
import { importLegacyData } from '../src/db/legacyImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

let db;
let repos;

before(() => {
  ({ db } = createMemDb(MIGRATIONS_DIR));
  repos = makeRepos(db);
});

after(() => {
  fs.rmSync(path.join(os.tmpdir(), 'eh-legacy-test'), { recursive: true, force: true });
});

test('schema migrates and repos can create org + user + license', async () => {
  const user = await repos.createUser({ googleSub: 'sub-123', email: 'a@x.com', name: 'Ana' });
  assert.ok(user.id);

  const org = await repos.createOrganization({ name: 'Org A', ownerUserId: user.id });
  assert.ok(org.id);

  await repos.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });
  const license = await repos.createLicense({ orgId: org.id, plan: 'pro', seats: 5, status: 'active' });
  assert.ok(license.id);
  assert.equal(license.plan, 'pro');

  const got = await repos.getLicenseByOrgId(org.id);
  assert.equal(got.id, license.id);
});

test('race_configs are strictly scoped by org (multi-tenancy)', async () => {
  const u1 = await repos.createUser({ googleSub: 'sub-1' });
  const u2 = await repos.createUser({ googleSub: 'sub-2' });
  const orgA = await repos.createOrganization({ name: 'Org A', ownerUserId: u1.id });
  const orgB = await repos.createOrganization({ name: 'Org B', ownerUserId: u2.id });

  const cfgA = await repos.createRaceConfig({ orgId: orgA.id, name: 'K1 8H', payloadJson: { a: 1 } });
  const cfgB = await repos.createRaceConfig({ orgId: orgB.id, name: 'K1 12H', payloadJson: { b: 2 } });

  // Org A sees only its own config
  assert.ok(await repos.getRaceConfig(orgA.id, cfgA.id), 'own config visible');
  assert.equal(await repos.getRaceConfig(orgA.id, cfgB.id), null, 'cross-org access must be null');
  assert.equal(await repos.getRaceConfig(orgB.id, cfgA.id), null, 'cross-org access must be null');

  const listA = await repos.listRaceConfigs(orgA.id);
  assert.deepEqual(listA.map((c) => c.id), [cfgA.id]);

  // update is also org-scoped
  const updated = await repos.updateRaceConfig(orgA.id, cfgA.id, { name: 'K1 8H v2' });
  assert.equal(updated.name, 'K1 8H v2');
  assert.equal(await repos.updateRaceConfig(orgB.id, cfgA.id, { name: 'HACK' }), null);
});

test('race_sessions are scoped by org and can be listed running', async () => {
  const u = await repos.createUser({ googleSub: 'sub-s' });
  const org = await repos.createOrganization({ name: 'Org S', ownerUserId: u.id });
  const cfg = await repos.createRaceConfig({ orgId: org.id, name: 'C', payloadJson: {} });

  const s1 = await repos.createRaceSession({ orgId: org.id, raceConfigId: cfg.id, status: 'running', circuitUrl: 'https://x' });
  await repos.createRaceSession({ orgId: org.id, raceConfigId: cfg.id, status: 'finished', circuitUrl: 'https://x' });

  const running = await repos.listRunningSessions();
  assert.deepEqual(running.map((r) => r.id), [s1.id]);

  const got = await repos.getRaceSession(org.id, s1.id);
  assert.equal(got.status, 'running');
});

test('legacy importer is idempotent and stores config/qualy/last-state', async () => {
  const dir = path.join(os.tmpdir(), 'eh-legacy-test');
  fs.mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, 'config.json');
  const qualyFile = path.join(dir, 'qualy.json');
  const stateFile = path.join(dir, 'last-state.json');
  fs.writeFileSync(configFile, JSON.stringify({ race: { ourKart: '77' }, apex: { circuitUrl: 'https://circuit' } }));
  fs.writeFileSync(qualyFile, JSON.stringify({ saved: true, drivers: [{ kart: '1' }] }));
  fs.writeFileSync(stateFile, JSON.stringify({ drivers: [] }));

  const files = { configFile, qualyFile, stateFile };
  const first = await importLegacyData(db, files);
  const second = await importLegacyData(db, files);

  assert.equal(first.orgId, second.orgId, 'same deterministic org');
  assert.equal(first.imported.config, true);
  assert.equal(first.imported.qualy, true);
  assert.equal(first.imported.lastState, true);

  // Idempotent: no duplicates on re-run
  const configs = await repos.listRaceConfigs(first.orgId);
  assert.equal(configs.length, 1, 'exactly one race_config after re-import');
  assert.equal(configs[0].payloadJson.race.ourKart, '77');

  const sessions = await repos.listRaceSessions(first.orgId);
  assert.equal(sessions.length, 1, 'exactly one session after re-import');
});
