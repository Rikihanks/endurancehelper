// Consistent application errors (spec section 38).
// Response shape: { error: "<snake_case_code>", message: "..." }
export class AppError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export const ErrorCodes = {
  UNAUTHENTICATED: { code: 'unauthenticated', status: 401 },
  FORBIDDEN: { code: 'forbidden', status: 403 },
  LICENSE_REQUIRED: { code: 'license_required', status: 402 },
  RESOURCE_NOT_FOUND: { code: 'resource_not_found', status: 404 },
  VALIDATION_ERROR: { code: 'validation_error', status: 400 },
  CONFLICT: { code: 'conflict', status: 409 },
  INTERNAL_ERROR: { code: 'internal_error', status: 500 },
};

export function appError(name, message) {
  const def = ErrorCodes[name] || ErrorCodes.INTERNAL_ERROR;
  return new AppError(def.code, def.status, message || def.code);
}

export function toErrorBody(err) {
  if (err instanceof AppError) {
    return { error: err.code, message: err.message };
  }
  return { error: 'internal_error', message: process.env.NODE_ENV === 'production' ? 'Internal server error' : String(err?.message || err) };
}
