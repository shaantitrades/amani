import { Router } from 'express';
import { z } from 'zod';
import { one } from '../lib/db.js';
import { asyncHandler, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { blockUser, unblockUser, invalidateBlockCache } from '../services/blocks.js';

const router = Router();

const targetSchema = z.object({
  user_id: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

/**
 * Blocage utilisateur (bouton 🚫).
 * Effet immediat : annonces, messages et notifications de la personne bloquee
 * disparaissent, et le bouton "Appeler" est desactive dans les deux sens.
 */
router.post(
  '/blocks',
  requireAuth,
  validateBody(targetSchema),
  asyncHandler(async (req, res) => {
    const { user_id: userId, reason } = req.body;
    if (userId === req.user.id) throw forbidden('cannot_block_self', 'Vous ne pouvez pas vous bloquer vous-meme');
    const target = await one('SELECT id FROM users WHERE id = $1', [userId]);
    if (!target) throw notFound('user_not_found', 'Utilisateur introuvable');

    await blockUser({ blockerId: req.user.id, blockedId: userId, reason: reason || null });
    res.status(201).json({ blocked: true, voiceKey: 'blocked' });
  }),
);

router.delete(
  '/blocks/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const removed = await unblockUser({ blockerId: req.user.id, blockedId: req.params.userId });
    res.json({ unblocked: removed, voiceKey: 'unblocked' });
  }),
);

/** Etat de blocage entre moi et un utilisateur (pour l'affichage du bouton). */
router.get(
  '/blocks/status/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await one('SELECT id FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [
      req.user.id,
      req.params.userId,
    ]);
    const reverse = await one('SELECT id FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [
      req.params.userId,
      req.user.id,
    ]);
    res.json({ i_blocked: Boolean(row), blocked_me: Boolean(reverse) });
  }),
);

/** Vider le cache de visibilite (debug / apres migration). */
router.post(
  '/blocks/cache/refresh',
  requireAuth,
  asyncHandler(async (req, res) => {
    await invalidateBlockCache(req.user.id);
    res.json({ ok: true });
  }),
);

export default router;
