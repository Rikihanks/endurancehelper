import { AppError, toErrorBody } from '../errors.js';
import { BILLING_INTERVALS } from './license.js';

export const SEATS = 5; // one product, up to 5 drivers for everyone

// Stripe is the source of truth for PAYMENT; this app remains the source of
// truth for AUTHORIZATION. The frontend only sends a billing interval
// (monthly|annual) — the backend maps it to the server-side Price ID and never
// trusts price/amount.
export function makeBillingService({ stripe, repos, priceIds, appUrl }) {
  async function upsertLicense(orgId, fields) {
    const existing = await repos.getLicenseByOrgId(orgId);
    if (existing) return repos.updateLicenseById(existing.id, fields);
    return repos.createLicense({ orgId, plan: 'monthly', seats: SEATS, status: 'active', ...fields });
  }

  // Map a Stripe subscription status to a license status explicitly.
  function mapSubscriptionStatus(status) {
    switch (status) {
      case 'active': return 'active';
      case 'trialing': return 'trialing';
      case 'canceled': return 'canceled';
      default: return 'past_due'; // past_due / unpaid / incomplete / incomplete_expired
    }
  }

  async function applySubscriptionStatus({ subscriptionId, customerId, status, currentPeriodEndSec }) {
    let license = subscriptionId ? await repos.findLicenseByStripeSubscriptionId(subscriptionId) : null;
    if (!license && customerId) license = await repos.findLicenseByStripeCustomerId(customerId);
    if (!license) return false;
    await repos.updateLicenseById(license.id, {
      status: mapSubscriptionStatus(status),
      stripeSubscriptionId: subscriptionId || license.stripeSubscriptionId,
      stripeCustomerId: customerId || license.stripeCustomerId,
      currentPeriodEnd: currentPeriodEndSec ? new Date(currentPeriodEndSec * 1000) : license.currentPeriodEnd,
    });
    return true;
  }

  return {
    // POST /api/billing/checkout { interval } — the backend decides the Price
    // ID for the requested billing interval (monthly | annual).
    async createCheckoutSession(orgId, interval = 'monthly') {
      if (!stripe) throw new AppError('billing_not_configured', 503, 'Stripe is not configured');
      if (!BILLING_INTERVALS.includes(interval)) throw new AppError('validation_error', 400, 'Unknown billing interval');
      const price = priceIds?.[interval];
      if (!price) throw new AppError('billing_not_configured', 503, `STRIPE_${interval.toUpperCase()}_PRICE_ID is not set`);

      const license = await repos.getLicenseByOrgId(orgId);
      const params = {
        mode: 'subscription',
        line_items: [{ price, quantity: 1 }],
        success_url: `${appUrl}/?checkout=success`,
        cancel_url: `${appUrl}/`,
        client_reference_id: orgId,
        metadata: { org_id: orgId, billing_interval: interval, seats: String(SEATS) },
        subscription_data: { metadata: { org_id: orgId, billing_interval: interval } },
      };
      if (license?.stripeCustomerId) params.customer = license.stripeCustomerId;
      return stripe.checkout.sessions.create(params);
    },

    // POST /api/billing/portal — manage card, invoices, cancel, renew.
    async createPortalSession(orgId) {
      if (!stripe) throw new AppError('billing_not_configured', 503, 'Stripe is not configured');
      const license = await repos.getLicenseByOrgId(orgId);
      if (!license?.stripeCustomerId) {
        throw new AppError('billing_not_configured', 409, 'No Stripe customer for this organization yet');
      }
      return stripe.billingPortal.sessions.create({ customer: license.stripeCustomerId, return_url: `${appUrl}/` });
    },

    // Webhook entry: idempotent by stripe_event_id (unique index). Duplicates
    // are acknowledged with 200 but never re-processed.
    async handleWebhookEvent(event) {
      const recorded = await repos.recordStripeWebhookEvent(event.id);
      if (!recorded) return { duplicate: true };
      await this.processEvent(event);
      return { duplicate: false };
    },

    async processEvent(event) {
      const obj = event.data?.object;
      switch (event.type) {
        case 'checkout.session.completed': {
          const orgId = obj.metadata?.org_id;
          if (!orgId) return;
          const interval = BILLING_INTERVALS.includes(obj.metadata?.billing_interval) ? obj.metadata.billing_interval : 'monthly';
          await upsertLicense(orgId, {
            plan: interval,
            seats: Number(obj.metadata?.seats) || SEATS,
            status: 'active',
            stripeCustomerId: obj.customer || null,
            stripeSubscriptionId: obj.subscription || null,
            currentPeriodEnd: obj.metadata?.period_end ? new Date(Number(obj.metadata.period_end) * 1000) : null,
          });
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await applySubscriptionStatus({
            subscriptionId: obj.id,
            customerId: obj.customer,
            status: obj.status,
            currentPeriodEndSec: obj.current_period_end,
          });
          break;
        case 'customer.subscription.deleted':
          await applySubscriptionStatus({
            subscriptionId: obj.id,
            customerId: obj.customer,
            status: 'canceled',
            currentPeriodEndSec: obj.current_period_end,
          });
          break;
        case 'invoice.paid':
          await applySubscriptionStatus({
            subscriptionId: obj.subscription,
            customerId: obj.customer,
            status: 'active',
            currentPeriodEndSec: obj.lines?.data?.[0]?.period?.end,
          });
          break;
        case 'invoice.payment_failed':
          await applySubscriptionStatus({
            subscriptionId: obj.subscription,
            customerId: obj.customer,
            status: 'past_due',
            currentPeriodEndSec: obj.lines?.data?.[0]?.period?.end,
          });
          break;
        default:
          break; // ignore unhandled event types
      }
    },
  };
}

export { toErrorBody };
