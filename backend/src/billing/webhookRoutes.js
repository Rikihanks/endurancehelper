import express from 'express';
import { toErrorBody } from '../errors.js';

// POST /api/webhooks/stripe
//
// Signature is ALWAYS verified with the raw body + Stripe signature header —
// the body is never trusted on its own (spec section 19). Mounted with
// express.raw() BEFORE express.json() so req.body is the raw Buffer.
export function createStripeWebhookRouter({ stripe, webhookSecret, billingService }) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    if (!webhookSecret || !stripe) {
      return res.status(503).json({ error: 'billing_not_configured', message: 'Stripe webhook secret is not set' });
    }
    const signature = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (_) {
      return res.status(400).json({ error: 'invalid_signature', message: 'Webhook signature verification failed' });
    }
    try {
      const result = await billingService.handleWebhookEvent(event);
      // Idempotency: duplicates are acknowledged but not re-applied.
      res.json({ received: true, duplicate: !!result.duplicate });
    } catch (e) {
      res.status(500).json(toErrorBody(e));
    }
  });

  return router;
}
