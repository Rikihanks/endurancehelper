// Drizzle schema — multi-tenant PostgreSQL model (spec sections 4-9).
//
// Every race-related entity belongs to an `organization` (directly or through
// a race_session / race_config). Access to these tables must ALWAYS be scoped
// by org_id taken from the authenticated session — never from client input.
import { pgTable, text, uuid, timestamp, integer, boolean, jsonb, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';

// ---- users (spec 4.1) ----
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  googleSub: text('google_sub').notNull().unique(), // stable Google identifier
  email: text('email'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('user'), // user | admin (GLOBAL admin — platform-wide)
  isActive: boolean('is_active').notNull().default(true), // false = deactivated (locked out, no delete)
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }), // most recent successful login
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- organizations (spec 4.2) ----
// The team IS the organization. InLap Box (ESP32) provisioning adds:
//   device_password_hash         -> hash of the password pilots enter on the
//                                   captive portal to register a box against
//                                   THIS team (only the hash is stored)
//   device_password_created_at   -> when that password was last generated, so
//                                   the admin panel can show "generada el..."
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  devicePasswordHash: text('device_password_hash'),
  devicePasswordCreatedAt: timestamp('device_password_created_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- memberships (spec 4.3) ----
export const memberships = pgTable('memberships', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'), // owner | admin | member
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.orgId] })]);

// ---- esp32_devices — physical InLap Box units owned by a team (spec InLapBox).
// The box registers itself with a team password (only the hash is stored on the
// org) and then authenticates on the telemetry WebSocket with a short-lived
// JWT. `aprobado` defaults to true (auto-approval at register); the flag exists
// so a future manual-approval flow can use it without a schema change. ----
export const esp32Devices = pgTable('esp32_devices', {
  id: uuid('id').primaryKey(),
  uuid: text('uuid').notNull().unique(), // chip-derived id sent by the box
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  deviceName: text('device_name').notNull().default(''), // pilot-set name, e.g. "Kart 3"
  pilotName: text('pilot_name').notNull().default(''), // pilot who owns this box
  approved: boolean('approved').notNull().default(true), // false = revoked from the admin
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  lastConnectionAt: timestamp('last_connection_at', { withTimezone: true }), // updated on every WS connect
}, (t) => [
  index('esp32_devices_org_idx').on(t.orgId),
]);

// ---- licenses (spec 5.1) ----
export const licenses = pgTable('licenses', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  plan: text('plan').notNull().default('free'), // free | pro
  seats: integer('seats').notNull().default(1),
  status: text('status').notNull().default('active'), // active | trialing | past_due | canceled | expired
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- race_configs (spec 6.1) ----
export const raceConfigs = pgTable('race_configs', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  name: text('name').notNull().default('Carrera'),
  payloadJson: jsonb('payload_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- race_sessions (spec 7.1) ----
export const raceSessions = pgTable('race_sessions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  raceConfigId: uuid('race_config_id').references(() => raceConfigs.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('created'), // created | running | finished | stopped | recovering
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  circuitUrl: text('circuit_url'),
  configJson: jsonb('config_json'), // frozen snapshot of the race config
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- race_laps (spec 8.1) — persisted for every race ----
export const raceLaps = pgTable('race_laps', {
  id: uuid('id').primaryKey(),
  raceSessionId: uuid('race_session_id').notNull().references(() => raceSessions.id, { onDelete: 'cascade' }),
  kart: text('kart').notNull(),
  lapNumber: integer('lap_number').notNull(),
  lapTimeMs: integer('lap_time_ms'),
  sectorTimes: jsonb('sector_times'),
  driverId: text('driver_id'),
  position: integer('position'),
  gapLiderMs: integer('gap_lider_ms'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('race_laps_session_idx').on(t.raceSessionId),
  index('race_laps_session_kart_idx').on(t.raceSessionId, t.kart),
  index('race_laps_session_kart_lap_idx').on(t.raceSessionId, t.kart, t.lapNumber),
]);

// ---- race_snapshots — periodic time-series for the post-race postmortem ----
// One row every N seconds while the race is live: our position, gap, virtual
// position, pace, and what the strategy engine was recommending at that moment.
export const raceSnapshots = pgTable('race_snapshots', {
  id: uuid('id').primaryKey(),
  raceSessionId: uuid('race_session_id').notNull().references(() => raceSessions.id, { onDelete: 'cascade' }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  elapsedMs: integer('elapsed_ms'),
  kart: text('kart'),
  position: integer('position'),
  gapLiderMs: integer('gap_lider_ms'),
  virtualPosition: integer('virtual_position'),
  laps: integer('laps'),
  stintLaps: integer('stint_laps'),
  driverId: text('driver_id'),
  driverName: text('driver_name'),
  avgPaceMs: integer('avg_pace_ms'),
  deltaToTargetMs: integer('delta_to_target_ms'),
  traffic: boolean('traffic'),
  rivalAheadDeltaMs: integer('rival_ahead_delta_ms'),
  rivalBehindDeltaMs: integer('rival_behind_delta_ms'),
  nextStopReason: text('next_stop_reason'),
  lapsUntilNextStop: integer('laps_until_next_stop'),
  stopsDone: integer('stops_done'),
  payload: jsonb('payload'),
}, (t) => [
  index('race_snapshots_session_timestamp_idx').on(t.raceSessionId, t.timestamp),
]);

// ---- race_events (spec 8.2) ----
export const raceEvents = pgTable('race_events', {
  id: uuid('id').primaryKey(),
  raceSessionId: uuid('race_session_id').notNull().references(() => raceSessions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // pit_stop | driver_change | penalty | kart_change | race_start | race_finish | strategy_change | ...
  payloadJson: jsonb('payload_json'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('race_events_session_timestamp_idx').on(t.raceSessionId, t.timestamp),
]);

// ---- stripe_webhook_events (spec 19) — idempotency ledger ----
export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  id: uuid('id').primaryKey(),
  stripeEventId: text('stripe_event_id').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('stripe_webhook_events_event_id_idx').on(t.stripeEventId),
]);

// ---- auth_sessions — server-side sessions (HttpOnly cookie, revocable) ----
// The cookie carries an opaque random token; only its SHA-256 hash is stored.
// Logout revokes the row; expired/revoked rows are ignored and pruned.
export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  index('auth_sessions_user_idx').on(t.userId),
]);

// ---- admin_audit_log — immutable trail of privileged mutations (admin panel).
// Every org-admin and global-admin write records who did what, with the
// before/after JSON of the affected row. Best added now, impossible to backfill
// cheaply later. ----
export const adminAuditLog = pgTable('admin_audit_log', {
  id: uuid('id').primaryKey(),
  actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'set null' }),
  scope: text('scope').notNull(), // 'org' | 'global'
  action: text('action').notNull(), // create | update | delete | promote | demote | add_member | remove_member | ...
  targetType: text('target_type').notNull(), // user | org | membership | license | session
  targetId: text('target_id'),
  orgId: uuid('org_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('admin_audit_log_actor_idx').on(t.actorUserId),
  index('admin_audit_log_created_idx').on(t.createdAt),
]);

// ---- esp32_command_configs — per-device command settings (auto-send intervals + manual) ----
export const esp32CommandConfigs = pgTable('esp32_command_configs', {
  id: uuid('id').primaryKey(),
  deviceId: uuid('device_id').notNull().references(() => esp32Devices.id, { onDelete: 'cascade' }),
  commandType: text('command_type').notNull(),
  commandText: text('command_text').notNull().default(''),
  intervalMs: integer('interval_ms'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('esp32_cmd_configs_device_idx').on(t.deviceId),
  uniqueIndex('esp32_cmd_configs_device_type_idx').on(t.deviceId, t.commandType),
]);

// ---- esp32_device_logs — event log per InLapBox device ----
export const esp32DeviceLogs = pgTable('esp32_device_logs', {
  id: uuid('id').primaryKey(),
  deviceId: uuid('device_id'), // nullable: auth failures may not have a device yet
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('esp32_logs_device_idx').on(t.deviceId),
  index('esp32_logs_org_idx').on(t.orgId),
  index('esp32_logs_created_idx').on(t.createdAt),
]);
