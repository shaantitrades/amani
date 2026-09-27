import { Router } from 'express';
import { healthCheck } from '../lib/db.js';
import { isRedisReady } from '../lib/cache.js';
import { startupState } from '../lib/startup-state.js';
import { storageHealth } from '../services/storage.js';
import { pushEnabled } from '../services/push.js';
import { sttEnabled } from '../services/stt.js';
import { imagePipelineAvailable } from '../services/media.js';
import { asyncHandler } from '../lib/errors.js';

const router = Router();

/**
 * Sonde Coolify / monitoring : renvoie 200 seulement si la base repond.
 * Le champ `startup` rend lisible la cause d'un demarrage degrade
 * (migrations impossible) directement depuis le navigateur :
 *   <domaine>/api/v1/healthz
 */
router.get(
  '/healthz',
  asyncHandler(async (req, res) => {
    const dbOk = await healthCheck().catch(() => false);
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      checks: {
        database: dbOk,
        redis: isRedisReady(),
        storage: storageHealth(),
        push: pushEnabled(),
        stt: sttEnabled(),
        imagePipeline: imagePipelineAvailable(),
      },
      startup: startupState(),
    });
  }),
);

/** Version de l'API (affichee par "Mon compte"). */
router.get('/version', (req, res) => {
  res.json({
    name: 'bodogui-api',
    version: '0.1.0',
    phase: 'MVP Phase 1',
    degraded: startupState().migrations === 'failed',
  });
});

export default router;
