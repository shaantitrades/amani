import pg from 'pg';
import env from '../config/env.js';
import logger from './logger.js';

const { Pool } = pg;

// Les BIGINT (price_amount, audit_log.id) doivent sortir en Number/string,
// pas en BigInt : JSON.stringify echoue sur les BigInt.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'Erreur inattendue du pool PostgreSQL');
});

/**
 * Execute une requete.
 * @param {string} text
 * @param {any[]} [params]
 */
export async function query(text, params = []) {
  const started = Date.now();
  try {
    const res = await pool.query(text, params);
    const ms = Date.now() - started;
    if (ms > 500) logger.warn({ ms, sql: text.slice(0, 160) }, 'Requete SQL lente');
    return res;
  } catch (err) {
    logger.error({ err: err.message, sql: text.slice(0, 200) }, 'Echec de la requete SQL');
    throw err;
  }
}

export async function one(text, params = []) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

export async function many(text, params = []) {
  const res = await query(text, params);
  return res.rows;
}

/** Transaction avec rollback automatique. */
export async function tx(handler) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr.message }, 'Echec du rollback');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function healthCheck() {
  const res = await query('SELECT 1 AS ok');
  return res.rows[0]?.ok === 1;
}

export async function closePool() {
  await pool.end();
}

export default { pool, query, one, many, tx, healthCheck, closePool };
