import express from 'express';
import { appError, toErrorBody } from '../errors.js';
import { asyncHandler } from '../server/middleware.js';

// Organization lifecycle. Onboarding (POST /) asks the user for the team name
// and the initial drivers via a wizard. There is NO free plan and NO feature
// tiers: the org is created WITHOUT a license and the user must subscribe
// (Stripe, monthly/annual) to unlock the app. Everyone gets up to 5 drivers.
// Protected at mount time with requireAuth.
export function createOrganizationsRouter({ repos }) {
  const router = express.Router();

  function handle(res, fn) {
    return fn()
      .then((data) => res.json(data))
      .catch((e) => res.status(e.status || 500).json(toErrorBody(e)));
  }

  function sanitizeDrivers(arr) {
    const num = (v) => (v === undefined ? undefined : Number(v));
    return (Array.isArray(arr) ? arr : [])
      .filter((d) => d && typeof d === 'object')
      .map((d) => ({
        name: typeof d.name === 'string' ? d.name.trim() : '',
        weightKg: num(d.weightKg) || 75,
        ballastKg: num(d.ballastKg) || 0,
        category: ['fast', 'avg', 'slow'].includes(d.category) ? d.category : 'avg',
      }));
  }

  // Strategy thresholds (step 4 of onboarding). Defaults match config.js.
  function sanitizeStrategy(s) {
    const num = (v, d) => (v === undefined || v === null || isNaN(Number(v)) ? d : Number(v));
    return {
      paceGoodSec: num(s?.paceGoodSec, 0.3),
      paceMediocreSec: num(s?.paceMediocreSec, 0.5),
      paceBadSec: num(s?.paceBadSec, 1.0),
      trafficGapSec: num(s?.trafficGapSec, 0.5),
      wetStopFactor: num(s?.wetStopFactor, 0.8),
      ballastPenaltySecPerKg: num(s?.ballastPenaltySecPerKg, 0.012),
      paceAdjustLaps: num(s?.paceAdjustLaps, 25),
      paceDropPct: num(s?.paceDropPct, 4),
    };
  }

  // POST /api/organizations — onboarding: team name + pilots.
  router.post('/', asyncHandler((req, res) =>
    handle(res, async () => {
      const { name, drivers = [], circuitUrl = '', strategy } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        throw appError('VALIDATION_ERROR', 'Team name is required');
      }
      const cleanDrivers = sanitizeDrivers(drivers);
      if (!cleanDrivers.length) throw appError('VALIDATION_ERROR', 'Add at least one driver');
      if (cleanDrivers.length > 10) throw appError('VALIDATION_ERROR', 'Up to 10 drivers');

      if (await repos.getUserPrimaryOrg(req.user.id)) {
        throw appError('CONFLICT', 'You already belong to an organization');
      }

      // Org WITHOUT a license: the user must subscribe (Stripe) to activate it.
      const org = await repos.createOrganization({ name: name.trim(), ownerUserId: req.user.id });
      await repos.createMembership({ userId: req.user.id, orgId: org.id, role: 'owner' });

      // Default race config built from the onboarding wizard: drivers, optional
      // circuit URL and strategy thresholds.
      const circuit = typeof circuitUrl === 'string' ? circuitUrl.trim() : '';
      const payload = {
        race: {
          numDrivers: cleanDrivers.length,
          drivers: cleanDrivers,
          driverOrder: cleanDrivers.map((_, i) => i),
        },
        apex: { circuitUrl: circuit },
        strategy: sanitizeStrategy(strategy),
        ui: { theme: 'dark' },
      };
      const cfg = await repos.createRaceConfig({ orgId: org.id, name: 'Configuración inicial', payloadJson: payload });

      return {
        org: { id: org.id, name: org.name, plan: null },
        configId: cfg.id,
      };
    })
  ));

  // GET /api/organizations/me — current org + billing interval.
  router.get('/me', asyncHandler((req, res) =>
    handle(res, async () => {
      if (!req.user.orgId) throw appError('RESOURCE_NOT_FOUND', 'No organization yet');
      const org = await repos.getOrganizationById(req.user.orgId);
      if (!org) throw appError('RESOURCE_NOT_FOUND', 'No organization yet');
      const lic = await repos.getLicenseByOrgId(req.user.orgId);
      const interval = lic ? lic.plan : null;
      return { org: { id: org.id, name: org.name, role: req.user.role, plan: interval } };
    })
  ));

  // GET /api/organizations/me/license — the current org's license (read-only).
  router.get('/me/license', asyncHandler((req, res) =>
    handle(res, async () => {
      if (!req.user.orgId) throw appError('RESOURCE_NOT_FOUND', 'No organization yet');
      const lic = await repos.getLicenseByOrgId(req.user.orgId);
      return { license: lic ? { plan: lic.plan, seats: lic.seats, status: lic.status, currentPeriodEnd: lic.currentPeriodEnd } : null };
    })
  ));

  // PUT /api/organizations/me — rename the team (owner only).
  router.put('/me', asyncHandler((req, res) =>
    handle(res, async () => {
      if (!req.user.orgId) throw appError('RESOURCE_NOT_FOUND', 'No organization yet');
      if (req.user.role !== 'owner') throw appError('FORBIDDEN', 'Only the owner can rename the organization');
      const { name } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) throw appError('VALIDATION_ERROR', 'Team name is required');
      const org = await repos.updateOrganization(req.user.orgId, { name: name.trim() });
      return { org: { id: org.id, name: org.name } };
    })
  ));

  return router;
}
