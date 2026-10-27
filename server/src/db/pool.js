import pg from 'pg';
import { config } from '../config.js';

// BIGINT (int8) comes back as a string by default. Our amounts are minor units and stay
// far below Number.MAX_SAFE_INTEGER, so parse them as numbers for simpler arithmetic.
pg.types.setTypeParser(20, (v) => Number(v));
// DATE columns: keep as 'YYYY-MM-DD' strings instead of shifting through local timezone.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Runs fn inside a transaction. fn receives a client; anything thrown rolls back.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
