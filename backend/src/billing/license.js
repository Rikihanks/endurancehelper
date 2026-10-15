// License authorization.
//
// There is ONE paid product with NO feature differences between billing
// intervals: everyone gets up to 5 drivers and race analysis. The only choice
// is how you pay: monthly or annual (annual is cheaper).
// The `licenses.plan` column stores the billing interval ('monthly' | 'annual').
//
// Only EXPLICITLY allowed statuses are authorized — never assume that any
// status other than 'canceled' means active.
import { AppError, appError } from '../errors.js';

export const ACTIVE_LICENSE_STATUSES = new Set(['active', 'trialing']);

export const BILLING_INTERVALS = ['monthly', 'annual'];

export function isLicenseActive(license) {
  return !!license && ACTIVE_LICENSE_STATUSES.has(license.status);
}

export function makeLicenseService(repos) {
  return {
    async getForOrg(orgId) {
      return orgId ? repos.getLicenseByOrgId(orgId) : null;
    },

    // Throws LICENSE_REQUIRED (402) unless the org has an active license.
    async assertActive(orgId) {
      const license = await this.getForOrg(orgId);
      if (!isLicenseActive(license)) {
        throw appError('LICENSE_REQUIRED', 'An active license is required');
      }
      return license;
    },

    // Remaining seats for an org (license.seats - current members).
    async seatsAvailable(orgId) {
      const license = await this.getForOrg(orgId);
      if (!license) return 0;
      const members = await repos.listMembershipsByOrg(orgId);
      return Math.max(0, license.seats - members.length);
    },
  };
}

export function makeLicenseMiddleware({ licenseService }) {
  // requireActiveLicense -> 402 { error: "license_required" }.
  async function requireActiveLicense(req, res, next) {
    try {
      await licenseService.assertActive(req.user?.orgId);
      next();
    } catch (e) {
      if (e instanceof AppError) {
        return res.status(e.status).json({ error: e.code, message: e.message });
      }
      throw e;
    }
  }

  return { requireActiveLicense };
}
