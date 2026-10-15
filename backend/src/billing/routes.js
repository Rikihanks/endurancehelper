import express from 'express';
import { AppError, toErrorBody } from '../errors.js';
import { asyncHandler } from '../server/middleware.js';

// Billing routes (spec section 18). Protected by requireAuth (checked at mount
// time) but NOT requireActiveLicense — a user without a license must be able
// to reach checkout to obtain one.
export function createBillingRouter({ billingService, rateLimitMw }) {
  const router = express.Router();
  const guard = rateLimitMw || ((req, res, next) => next());

  function handle(res, fn) {
    return fn()
      .then((data) => res.json(data))
      .catch((e) => {
        const status = e instanceof AppError ? e.status : 500;
        res.status(status).json(toErrorBody(e));
      });
  }

  router.post('/checkout', guard, asyncHandler((req, res) =>
    handle(res, async () => {
      const { interval } = req.body || {};
      const session = await billingService.createCheckoutSession(req.user.orgId, interval);
      return { url: session.url, sessionId: session.id };
    })
  ));

  router.post('/portal', guard, asyncHandler((req, res) =>
    handle(res, async () => {
      const session = await billingService.createPortalSession(req.user.orgId);
      return { url: session.url };
    })
  ));

  return router;
}
