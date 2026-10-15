import express from 'express';
import { appError, toErrorBody } from '../errors.js';
import { asyncHandler } from '../server/middleware.js';
import { BILLING_INTERVALS } from '../billing/license.js';

// DEV-ONLY tooling (mounted only when NODE_ENV !== 'production').
// POST /api/dev/license { interval: 'monthly' | 'annual' } grants/upgrades a
// license for the authenticated user's org so the paid flow can be tested
// without real Stripe keys. Never present in production builds.
export function createDevRouter({ repos }) {
  const router = express.Router();

  function handle(res, fn) {
    return fn()
      .then((data) => res.json(data))
      .catch((e) => res.status(e.status || 500).json(toErrorBody(e)));
  }

  router.post('/license', asyncHandler((req, res) =>
    handle(res, async () => {
      if (!req.user?.orgId) throw appError('RESOURCE_NOT_FOUND', 'No organization yet — complete onboarding first');
      const interval = req.body?.interval;
      if (!BILLING_INTERVALS.includes(interval)) throw appError('VALIDATION_ERROR', 'Unknown billing interval (monthly | annual)');

      const existing = await repos.getLicenseByOrgId(req.user.orgId);
      if (existing) {
        await repos.updateLicenseById(existing.id, { plan: interval, seats: 5, status: 'active', currentPeriodEnd: null });
      } else {
        await repos.createLicense({ orgId: req.user.orgId, plan: interval, seats: 5, status: 'active' });
      }
      return { ok: true, interval, dev: true };
    })
  ));

  return router;
}
