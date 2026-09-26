import env from './config/env.js';
import logger from './lib/logger.js';
import { createApp } from './app.js';
import { initCache, closeCache, isRedisReady } from './lib/cache.js';
import { closePool, healthCheck } from './lib/db.js';
import { initPush } from './services/push.js';
import { dispatchQueued } from './services/notifications.js';
import { purgeExpiredOtp } from './services/otp.js';

const app = createApp();

let workerTimer = null;
let purgeTimer = null;
let isDispatching = false;

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

async function start() {
  initCache();
  initPush();
  startWorkers();

  const dbOk = await healthCheck().catch(() => false);
  if (!dbOk) logger.warn('Base de donnees injoignable au demarrage : /healthz renverra 503');
  if (!isRedisReady()) logger.warn('Redis indisponible : cache en memoire (degradation acceptable)');
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

start().catch((err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Echec du demarrage');
  process.exit(1);
});

export default app;
