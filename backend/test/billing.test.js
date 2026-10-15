import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createMemDb } from './helpers/pgmem.js';
import { makeRepos } from '../src/db/repos.js';
import { makeSessionService } from '../src/auth/session.js';
import { makeAuthMiddleware } from '../src/auth/middleware.js';
import { createAuthRouter } from '../src/auth/routes.js';
import { makeBillingService } from '../src/billing/billingService.js';
import { createBillingRouter } from '../src/billing/routes.js';
import { createStripeWebhookRouter } from '../src/billing/webhookRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

const MONTHLY_PRICE = 'price_monthly_123';
const ANNUAL_PRICE = 'price_annual_456';
const APP_URL = 'https://app.example.test';

function setup() {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  return { db, repos };
}

async function makeOrgWithUser(repos) {
  const user = await repos.createUser({ googleSub: 'sub-bill', email: 'bill@x.com', name: 'Bill' });
  const org = await repos.createOrganization({ name: 'Bill Org', ownerUserId: user.id });
  await repos.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });
  return { user, org };
}

function event(id, type, object) {
  return { id, type, data: { object } };
}

test('createCheckoutSession: backend decides price + metadata (never trusts frontend)', async () => {
  const { repos } = setup();
  const { org } = await makeOrgWithUser(repos);
  const calls = [];
  const stripe = { checkout: { sessions: { create: (p) => { calls.push(p); return { id: 'cs_1', url: 'https://checkout.test/1' }; } } } };
  const billing = makeBillingService({ stripe, repos, priceIds: { monthly: MONTHLY_PRICE, annual: ANNUAL_PRICE }, appUrl: APP_URL });

  const session = await billing.createCheckoutSession(org.id, 'monthly');
  assert.equal(session.url, 'https://checkout.test/1');
  assert.equal(calls[0].mode, 'subscription');
  assert.equal(calls[0].line_items[0].price, MONTHLY_PRICE, 'price id comes from server config');
  assert.equal(calls[0].metadata.org_id, org.id);
  assert.equal(calls[0].metadata.billing_interval, 'monthly');
  assert.equal(calls[0].metadata.seats, '5');
  assert.equal(calls[0].client_reference_id, org.id);
  assert.equal(calls[0].success_url, `${APP_URL}/?checkout=success`);
  assert.ok(!('customer' in calls[0]), 'no customer yet');
});

test('createCheckoutSession reuses the existing Stripe customer', async () => {
  const { repos } = setup();
  const { org } = await makeOrgWithUser(repos);
  await repos.createLicense({ orgId: org.id, plan: 'annual', seats: 5, status: 'active', stripeCustomerId: 'cus_1' });
  const calls = [];
  const stripe = { checkout: { sessions: { create: (p) => { calls.push(p); return { id: 'cs_2', url: 'u' }; } } } };
  const billing = makeBillingService({ stripe, repos, priceIds: { monthly: MONTHLY_PRICE, annual: ANNUAL_PRICE }, appUrl: APP_URL });

  await billing.createCheckoutSession(org.id, 'annual');
  assert.equal(calls[0].customer, 'cus_1');
});

test('createCheckoutSession picks the Price ID by billing interval and rejects unknown', async () => {
  const { repos } = setup();
  const { org } = await makeOrgWithUser(repos);
  const calls = [];
  const stripe = { checkout: { sessions: { create: (p) => { calls.push(p); return { id: 'cs_x', url: 'u' }; } } } };
  const billing = makeBillingService({ stripe, repos, priceIds: { monthly: MONTHLY_PRICE, annual: ANNUAL_PRICE }, appUrl: APP_URL });

  await billing.createCheckoutSession(org.id, 'monthly');
  await billing.createCheckoutSession(org.id, 'annual');
  assert.equal(calls[0].line_items[0].price, MONTHLY_PRICE);
  assert.equal(calls[0].metadata.billing_interval, 'monthly');
  assert.equal(calls[0].metadata.seats, '5');
  assert.equal(calls[1].line_items[0].price, ANNUAL_PRICE);
  assert.equal(calls[1].metadata.billing_interval, 'annual');
  assert.equal(calls[1].metadata.seats, '5');

  await assert.rejects(() => billing.createCheckoutSession(org.id, 'enterprise'), /Unknown billing interval/);
});

test('checkout.session.completed creates the license with the billing interval', async () => {
  const { repos } = setup();
  const { org } = await makeOrgWithUser(repos);
  const billing = makeBillingService({ stripe: null, repos, priceIds: { monthly: MONTHLY_PRICE, annual: ANNUAL_PRICE }, appUrl: APP_URL });

  await billing.handleWebhookEvent(event('evt_monthly', 'checkout.session.completed', { customer: 'cus_p', subscription: 'sub_p', metadata: { org_id: org.id, billing_interval: 'monthly', seats: '5' } }));
  let license = await repos.getLicenseByOrgId(org.id);
  assert.equal(license.plan, 'monthly');
  assert.equal(license.status, 'active');
  assert.equal(license.seats, 5);

  // Switch to annual via a new checkout
  await billing.handleWebhookEvent(event('evt_annual', 'checkout.session.completed', { customer: 'cus_p', subscription: 'sub_p2', metadata: { org_id: org.id, billing_interval: 'annual', seats: '5' } }));
  license = await repos.getLicenseByOrgId(org.id);
  assert.equal(license.plan, 'annual');
  assert.equal(license.seats, 5);
});

test('createPortalSession requires a Stripe customer', async () => {
  const { repos } = setup();
  const { org } = await makeOrgWithUser(repos);
  const billing = makeBillingService({ stripe: { billingPortal: { sessions: { create: async () => ({ url: 'u' }) } } }, repos, priceIds: { monthly: MONTHLY_PRICE, annual: ANNUAL_PRICE }, appUrl: APP_URL });
  await assert.rejects(() => billing.createPortalSession(org.id), /Stripe customer/);
});

test('createPortalSession returns portal url when customer exists', async () => {
  const { repos } = setup();
  const { org } = await makeOrgWithUser(repos);
  await repos.createLicense({ orgId: org.id, plan: 'annual', seats: 5, status: 'active', stripeCustomerId: 'cus_9' });
  const portal = { sessions: { create: (p) => ({ url: 'https://portal.test', ...p }) } };
  const billing = makeBillingService({ stripe: { billingPortal: portal }, repos, priceIds: { monthly: MONTHLY_PRICE, annual: ANNUAL_PRICE }, appUrl: APP_URL });
  const res = await billing.createPortalSession(org.id);
  assert.equal(res.url, 'https://portal.test');
  assert.equal(res.customer, 'cus_9');
  assert.equal(res.return_url, `${APP_URL}/`);
});

test('webhook idempotency: duplicate event is recorded once and applied once', async () => {
  const { repos } = setup();
  const { org } = await makeOrgWithUser(repos);
  const billing = makeBillingService({ stripe: null, repos, priceIds: { monthly: MONTHLY_PRICE, annual: ANNUAL_PRICE }, appUrl: APP_URL });

  const ev = event('evt_1', 'checkout.session.completed', { customer: 'cus_x', subscription: 'sub_1', metadata: { org_id: org.id } });

  const first = await billing.handleWebhookEvent(ev);
  const second = await billing.handleWebhookEvent(ev);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true, 'duplicate detected via unique stripe_event_id');

  const license = await repos.getLicenseByOrgId(org.id);
  assert.ok(license, 'license created once');
  assert.equal(license.status, 'active');
  assert.equal(license.stripeCustomerId, 'cus_x');
  assert.equal(license.stripeSubscriptionId, 'sub_1');
});

test('webhook events sync license status (spec section 20)', async () => {
  const { repos } = setup();
  const { org } = await makeOrgWithUser(repos);
  const billing = makeBillingService({ stripe: null, repos, priceIds: { monthly: MONTHLY_PRICE, annual: ANNUAL_PRICE }, appUrl: APP_URL });

  await billing.handleWebhookEvent(event('e1', 'checkout.session.completed', { customer: 'cus_a', subscription: 'sub_a', metadata: { org_id: org.id } }));
  let license = await repos.getLicenseByOrgId(org.id);
  assert.equal(license.status, 'active');

  await billing.handleWebhookEvent(event('e2', 'customer.subscription.updated', { id: 'sub_a', customer: 'cus_a', status: 'past_due' }));
  license = await repos.getLicenseByOrgId(org.id);
  assert.equal(license.status, 'past_due', 'payment failed -> past_due');

  await billing.handleWebhookEvent(event('e3', 'invoice.paid', { subscription: 'sub_a', customer: 'cus_a', lines: { data: [{ period: { end: 2000000000 } }] } }));
  license = await repos.getLicenseByOrgId(org.id);
  assert.equal(license.status, 'active', 'invoice paid -> active');
  assert.ok(license.currentPeriodEnd, 'period end set');

  await billing.handleWebhookEvent(event('e4', 'customer.subscription.deleted', { id: 'sub_a', customer: 'cus_a', status: 'canceled' }));
  license = await repos.getLicenseByOrgId(org.id);
  assert.equal(license.status, 'canceled', 'subscription deleted -> canceled');
});

// ---- HTTP layer ----
function fakeStripe(eventsBySig) {
  return {
    checkout: { sessions: { create: async (p) => ({ id: 'cs_http', url: 'https://checkout.test/http' }) } },
    billingPortal: { sessions: { create: async (p) => ({ url: 'https://portal.test' }) } },
    webhooks: {
      constructEvent: (payload, sig, secret) => {
        if (sig === 'VALID_SIG' && secret === 'whsec_test') {
          return eventsBySig['VALID_SIG'] || JSON.parse(payload.toString());
        }
        throw new Error('bad signature');
      },
    },
  };
}

async function startBillingServer({ eventsBySig = {} } = {}) {
  const { db } = createMemDb(MIGRATIONS_DIR);
  const repos = makeRepos(db);
  const sessionService = makeSessionService(repos);
  const authMw = makeAuthMiddleware({ repos, sessionService });

  const app = express();
  app.use('/api/webhooks/stripe', express.raw({ type: '*/*' }));
  app.use(express.json());
  app.use(cookieParser());

  app.use('/api/auth', createAuthRouter({
    repos,
    sessionService,
    verifyGoogleIdToken: async () => ({ sub: 'sub-http', email: 'h@x.com', name: 'H', picture: '' }),
    requireAuth: authMw.requireAuth,
    googleClientId: 'client',
  }));

  const billingService = makeBillingService({ stripe: fakeStripe(eventsBySig), repos, priceIds: { monthly: MONTHLY_PRICE, annual: ANNUAL_PRICE }, appUrl: APP_URL });
  app.use('/api/billing', authMw.requireAuth, createBillingRouter({ billingService }));
  app.use('/api/webhooks/stripe', createStripeWebhookRouter({ stripe: fakeStripe(eventsBySig), webhookSecret: 'whsec_test', billingService }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://localhost:${server.address().port}`, repos, sessionService };
}

async function login(base) {
  const res = await fetch(`${base}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'tok' }) });
  return res.headers.get('set-cookie').split(';')[0];
}

test('HTTP: /api/billing/checkout requires auth -> 401', async () => {
  const { server, base } = await startBillingServer();
  try {
    const res = await fetch(`${base}/api/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 401);
  } finally { server.close(); }
});

test('HTTP: /api/billing/checkout with auth returns a checkout url', async () => {
  const { server, base } = await startBillingServer();
  try {
    const cookie = await login(base);
    const res = await fetch(`${base}/api/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ interval: 'annual' }) });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.match(data.url, /checkout/);
  } finally { server.close(); }
});

test('HTTP: webhook with invalid signature -> 400', async () => {
  const { server, base } = await startBillingServer();
  try {
    const res = await fetch(`${base}/api/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 'BAD' }, body: '{"id":"evt_http_1","type":"x"}' });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'invalid_signature');
  } finally { server.close(); }
});

test('HTTP: webhook applies event, duplicate returns 200 and does not re-apply', async () => {
  const { server, base, repos } = await startBillingServer({});
  try {
    const cookie = await login(base);
    // Onboarding (login no longer auto-creates an org): give the user a real org.
    const user = await repos.findUserByGoogleSub('sub-http');
    const org = await repos.createOrganization({ name: 'Webhook Org', ownerUserId: user.id });
    await repos.createMembership({ userId: user.id, orgId: org.id, role: 'owner' });

    const ev = event('evt_http_dup', 'checkout.session.completed', { customer: 'cus_http', subscription: 'sub_http', metadata: { org_id: org.id } });

    const raw = JSON.stringify(ev);
    const h = { 'Content-Type': 'application/json', 'stripe-signature': 'VALID_SIG' };
    const first = await fetch(`${base}/api/webhooks/stripe`, { method: 'POST', headers: h, body: raw });
    const second = await fetch(`${base}/api/webhooks/stripe`, { method: 'POST', headers: h, body: raw });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const d1 = await first.json();
    const d2 = await second.json();
    assert.equal(d1.duplicate, false);
    assert.equal(d2.duplicate, true);

    const license = await repos.getLicenseByOrgId(org.id);
    assert.ok(license, 'license created exactly once');
  } finally { server.close(); }
});
