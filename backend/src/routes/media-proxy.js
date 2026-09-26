import { Router } from 'express';
import { one } from '../lib/db.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getObject, deleteObject } from '../services/storage.js';
import logger from '../lib/logger.js';

/**
 * Proxy public des medias : GET /media/<cle>.
 *
 * Monte a la RACINE (et non sous /api/v1) car :
 *  - l'URL est stable meme si l'on change de fournisseur (MinIO -> Backblaze B2)
 *  - Cloudflare peut mettre en cache sur ce chemin (/media/*) sans toucher a l'API
 *  - le bucket n'est jamais expose publiquement
 *
 * Le motif est une RegExp : Express 4 ne gere pas les jokers nommes (`/media/*key`).
 */
const router = Router();

router.get(
  /^\/media\/(.+)$/,
  asyncHandler(async (req, res) => {
    const key = req.params[0];
    const obj = await getObject(key);
    if (!obj) throw notFound('media_not_found', 'Media introuvable');
    res.set('Content-Type', obj.contentType);
    if (obj.size) res.set('Content-Length', String(obj.size));
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    obj.stream.on('error', (err) => {
      logger.warn({ err: err.message }, 'Erreur de flux media');
      res.destroy(err);
    });
    obj.stream.pipe(res);
  }),
);

/** Suppression d'un media non encore rattache a une annonce (avant publication). */
router.delete(
  /^\/media\/(.+)$/,
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = req.params[0];
    const asset = await one('SELECT * FROM media_assets WHERE storage_key = $1 AND owner_id = $2', [key, req.user.id]);
    if (!asset) throw notFound('media_not_found', 'Media introuvable');
    if (asset.ad_id) throw badRequest('media_in_use', 'Ce media est rattache a une annonce');
    await deleteObject(key);
    await one('DELETE FROM media_assets WHERE id = $1', [asset.id]);
    res.json({ deleted: true, voiceKey: 'ad_deleted' });
  }),
);

export default router;
