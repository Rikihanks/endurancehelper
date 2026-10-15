import fs from 'node:fs';
import path from 'node:path';
import { newDb, DataType } from 'pg-mem';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';

// pg-mem v3 has bugs with bound parameters (e.g. comparing an indexed/PK
// column to $1 throws "No execution context available", and DEFAULT values are
// evaluated only once per column). To keep the DB tests reliable we INLINE the
// parameters as SQL literals and execute the plain SQL text instead of
// prepare().bind().executeAll().
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function inlineParams(text, params) {
  if (!params || !params.length) return text;
  return text.replace(/\$(\d+)/g, (m, i) => literal(params[Number(i) - 1]));
}

function makeMemClient(mem) {
  return {
    async connect() {},
    async query(textOrConfig, params) {
      const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
      const sql = inlineParams(text, params);
      let result;
      try {
        result = mem.public.query(sql);
      } catch (e) {
        // A single logical query may contain several statements; fall back to
        // executing each statement separately for better error attribution.
        result = null;
        throw e;
      }
      const fields = (result.fields || []).map((f) => ({ ...f, dataTypeID: f.typeId }));
      // drizzle uses rowMode:'array' — rows must be arrays ordered by fields.
      const arrayMode = typeof textOrConfig !== 'string' && textOrConfig.rowMode === 'array';
      const rows = arrayMode ? result.rows.map((r) => fields.map((f) => r[f.name])) : result.rows;
      return {
        rows,
        rowCount: result.rowCount,
        command: result.command,
        fields,
      };
    },
  };
}

// Build an in-memory PostgreSQL (pg-mem) + drizzle instance by executing the
// SAME versioned migration SQL files used in production.
export function createMemDb(migrationsDir) {
  const mem = newDb();
  mem.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID });

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const s = stmt.trim();
      if (s) mem.public.none(s);
    }
  }

  const db = drizzle(makeMemClient(mem));
  return { mem, db };
}
