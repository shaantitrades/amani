import env from './config/env.js';
import logger from './lib/logger.js';
import { createApp } from './app.js';
import { initCache, closeCache, isRedisReady } from './lib/cache.js';
import { closePool, healthCheck } from './lib/db.js';
import { runMigrations } from './db/migrate.js';
import { startupHint } from './lib/startup-hint.js';
import { setMigrationFailure, setMigrationsReady } from './lib/startup-state.js';
import { initPush } from './services/push.js';
import { dispatchQueued } from './services/notifications.js';
import { purgeExpiredOtp } from './services/otp.js';

const app = createApp();

let workerTimer = null;
let purgeTimer = null;
let isDispatching = false;

const MIGRATE_ATTEMPTS = Math.max(1, Number(process.env.MIGRATE_ATTEMPTS || 12));
const MIGRATE_RETRY_MS = Math.max(250, Number(process.env.MIGRATE_RETRY_MS || 5000));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Migrations avec nouvelles tentatives.
 * Postgres peut refuser les connexions quelques secondes apres un redemarrage
 * du service `db` : sans tentatives, un demarrage concurrent suffisait a tuer
 * l'API (et donc a rendre tout /api/v1 indisponible).
 */
async function migrateWithRetry() {
  for (let attempt = 1; attempt <= MIGRATE_ATTEMPTS; attempt += 1) {
    try {
      const applied = await runMigrations();
      setMigrationsReady(applied.length);
      logger.info({ attempt, applied: applied.length }, 'Migrations terminees');
      return applied;
    } catch (err) {
      const last = attempt >= MIGRATE_ATTEMPTS;
      logger.error(
        { attempt, attempts: MIGRATE_ATTEMPTS, err: err.message, hint: startupHint(err) },
        last ? 'Migration impossible' : 'Migration echouee, nouvel essai',
      );
      if (last) throw err;
      await sleep(MIGRATE_RETRY_MS);
    }
  }
  return [];
}

/**
 * Worker de notifications : relit la file `notifications` et envoie
 * SMS / push. Tourne dans le meme conteneur (suffisant pour le MVP) ;
 * desactivable avec DISABLE_WORKERS=1 pour les tests.
 */
function startWorkers() {
  if (process.env.DISABLE_WORKERS === '1') {
    logger.warn('Workers desactives (DISABLE_WORKERS=1)');
    return;
  }
  workerTimer = setInterval(async () => {
    if (isDispatching) return;
    isDispatching = true;
    try {
      const result = await dispatchQueued({ limit: 25 });
      if (result.processed) logger.info(result, 'Notifications traitees');
    } catch (err) {
      logger.error({ err: err.message }, 'Echec du worker de notifications');
    } finally {
      isDispatching = false;
    }
  }, 30_000);

  // Purge des codes OTP expires une fois par jour
  purgeTimer = setInterval(
    async () => {
      try {
        const deleted = await purgeExpiredOtp();
        logger.info({ deleted }, 'Purge des codes OTP');
      } catch (err) {
        logger.warn({ err: err.message }, 'Purge OTP echouee');
      }
    },
    24 * 3600 * 1000,
  );

  logger.info('Workers demarres (notifications 30 s, purge OTP 24 h)');
}

async function startServer() {
  initCache();
  initPush();

  // Migrations AVANT le reste : le conteneur lancait auparavant
  // `node src/db/migrate.js && node src/server.js`, donc le moindre echec de
  // migration tuait l'API (502 opaque sur tout /api/v1, sans piste lisible).
  // Desormais : tentatives multiples, puis demarrage en mode degrade dont la
  // cause reste consultable sur /api/v1/healthz.
  try {
    await migrateWithRetry();
  } catch (err) {
    setMigrationFailure(err, startupHint(err));
    if (process.env.STRICT_STARTUP === '1') throw err;
    logger.error(
      { err: err.message, hint: startupHint(err) },
      "Migrations impossibles : l'API demarre en mode degrade (cause sur /api/v1/healthz)",
    );
  }

  startWorkers();

  const dbOk = await healthCheck().catch(() => false);
  if (!dbOk) logger.warn('Base de donnees injoignable au demarrage : /healthz renverra 503');
  if (!isRedisReady()) logger.warn('Redis indisponible : cache en memoire (degradation acceptable)');
  if (env.corsOrigins.length === 0) {
    logger.warn(
      'CORS_ORIGINS vide : toutes les origines sont acceptees. Definir la liste des domaines du site pour la production.',
    );
  }
  if (env.testLoginEnabled) {
    logger.warn(
      { phones: env.testLoginPhones },
      'Connexion de test activee (code fixe, sans SMS) : a desactiver apres la recette',
    );
  }

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API Bodogui demarree');
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Arret en cours');
    clearInterval(workerTimer);
    clearInterval(purgeTimer);
    server.close(async () => {
      await closeCache().catch(() => {});
      await closePool().catch(() => {});
      process.exit(0);
    });
    // Filet de securite si une connexion reste ouverte
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Promesse rejetee non geree'));
}

export { startServer };

export default app;
