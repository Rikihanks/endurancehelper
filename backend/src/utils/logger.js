// Structured JSON logger (spec section 37). No external dependency; fields are
// always JSON-serializable and secrets are redacted. Requests carry
// requestId/userId/orgId context via logger.child(fields).

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEYS = /(password|token|secret|authorization|credential|cookie|key|jwt)/i;

function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map(redact);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  if (SECRET_KEYS.test(String(value))) return '[REDACTED]';
  return value;
}

export function createLogger({ level = process.env.LOG_LEVEL || 'info', stream = process.stdout } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(levelName, msg, fields = {}) {
    if (LEVELS[levelName] < threshold) return;
    const line = JSON.stringify(redact({ level: levelName, time: new Date().toISOString(), msg, ...fields }));
    stream.write(line + '\n');
  }

  return {
    level,
    child(fields = {}) {
      return {
        info: (msg, extra = {}) => write('info', msg, { ...fields, ...extra }),
        warn: (msg, extra = {}) => write('warn', msg, { ...fields, ...extra }),
        error: (msg, extra = {}) => write('error', msg, { ...fields, ...extra }),
        debug: (msg, extra = {}) => write('debug', msg, { ...fields, ...extra }),
      };
    },
    info: (msg, fields = {}) => write('info', msg, fields),
    warn: (msg, fields = {}) => write('warn', msg, fields),
    error: (msg, fields = {}) => write('error', msg, fields),
    debug: (msg, fields = {}) => write('debug', msg, fields),
  };
}

export const logger = createLogger();
