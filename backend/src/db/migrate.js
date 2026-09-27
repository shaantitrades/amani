import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../lib/db.js';
import logger from '../lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');
const LOCK_ID = 918273645;

export async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function runMigrations({ log = logger } = {}) {
  await ensureMigrationsTable();
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const client = await pool.connect();
  try {
    // Verrou consultatif de session : evite que deux conteneurs migrent en meme temps.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const executed = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      log.info({ file }, 'Application de la migration');

      // Une transaction PAR fichier : indispensable pour les migrations qui
      // ajoutent une valeur d'enum (impossible a utiliser dans la meme
      // transaction) et plus sur : un echec n'annule que ce fichier.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        executed.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        log.error({ file, err: err.message }, 'Migration echouee (transaction annulee)');
        throw err;
      }
    }

    log.info({ applied: executed.length, total: files.length }, 'Migrations a jour');
    return executed;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

/**
 * Aide lisible pour les echecs de connexion les plus frequents au demarrage.
 * Sans elle, le conteneur `api` sort en laissant un 502 opaque cote Nginx.
 * @returns {string|null}
 */
export function startupHint(err) {
  const message = String(err?.message || err || '');
  if (/password authentication failed|SASL|client password must be a string|no password supplied/i.test(message)) {
    return "Postgres refuse le mot de passe. Il doit etre identique a celui utilise lors de la creation du volume db-data : soit remettre l'ancien POSTGRES_PASSWORD, soit supprimer le volume db-data (donnees de recette) puis redeployer.";
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
    return 'Postgres est injoignable : verifier que le service db est demarre et que DATABASE_URL pointe vers db:5432.';
  }
  if (/invalid url|URI malformed|percent-encoding|URIError/i.test(message)) {
    return "DATABASE_URL est invalide : le mot de passe contient probablement +, /, = ou @ (typique d'openssl rand -base64). Utiliser un mot de passe hexadecimal : openssl rand -hex 24.";
  }
  return null;
}

if (isDirectRun) {
  runMigrations()
    .then(async (executed) => {
      logger.info({ executed }, 'Migration terminee');
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error(
        { err: err.message, hint: startupHint(err) },
        "Echec de la migration (l'API ne demarrera pas)",
      );
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

export default runMigrations;
