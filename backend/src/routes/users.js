import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../lib/db.js';
import { asyncHandler, forbidden, notFound, badRequest } from '../lib/errors.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { readPage } from '../lib/pagination.js';
import { publicUser } from '../lib/serialize.js';
import { listOwnerAds, ownerStats } from '../services/ads.js';
import { isBlocked } from '../services/blocks.js';
import { saveSubscription, removeSubscription } from '../services/push.js';
import { listNotifications } from '../services/notifications.js';
import { isSupportedLanguage } from '../services/voice.js';
import { OWNER_AD_STATUSES } from '../lib/visibility.js';

const router = Router();

/** Profil courant + statistiques (annonces publiees, messages non lus). */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user, adsCount, unread] = await Promise.all([
      one(
        `SELECT u.*, d.name AS district_name FROM users u
         LEFT JOIN districts d ON d.id = u.district_id WHERE u.id = $1`,
        [req.user.id],
      ),
      one(`SELECT count(*)::int AS n FROM ads WHERE owner_id = $1 AND status = 'published'`, [req.user.id]),
      one(`SELECT count(*)::int AS n FROM messages WHERE recipient_id = $1 AND read_at IS NULL`, [req.user.id]),
    ]);
    res.json({
      user: publicUser(user),
      stats: { publishedAds: adsCount?.n || 0, unreadMessages: unread?.n || 0 },
    });
  }),
);

/** Suppression definitive du compte et de ses donnees. */
router.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    await query('DELETE FROM push_subscriptions WHERE user_id = $1', [req.user.id]);
    await query('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.json({ ok: true, voiceKey: 'account_deleted' });
  }),
);

const profileSchema = z.object({
  name: z.string().max(80).optional(),
  name_audio_key: z.string().max(300).optional(),
  avatar_key: z.string().max(300).optional().nullable(),
  language: z.string().length(2).optional(),
  district_id: z.string().uuid().optional().nullable(),
  // `district_id: null` ne suffit pas (COALESCE) : c'est ce drapeau qui retire le quartier.
  clear_district: z.boolean().optional(),
  city: z.string().max(80).optional().nullable(),
  notify_sms: z.boolean().optional(),
  notify_push: z.boolean().optional(),
});

/** Mise a jour du profil (nom vocal, photo, quartier, langue, notifications). */
router.patch(
  '/me',
  requireAuth,
  validateBody(profileSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (b.language && !isSupportedLanguage(b.language)) {
      throw badRequest('unsupported_language', 'Langue non supportee', { voiceKey: 'error_generic' });
    }
    const updated = await one(
      `UPDATE users SET
         name = COALESCE($2, name),
         name_audio_key = COALESCE($3, name_audio_key),
         avatar_key = COALESCE($4, avatar_key),
         language = COALESCE($5, language),
         district_id = CASE WHEN $10 THEN NULL ELSE COALESCE($6, district_id) END,
         city = COALESCE($7, city),
         notify_sms = COALESCE($8, notify_sms),
         notify_push = COALESCE($9, notify_push)
       WHERE id = $1
       RETURNING *`,
      [
        req.user.id,
        b.name ?? null,
        b.name_audio_key ?? null,
        b.avatar_key ?? null,
        b.language ?? null,
        b.district_id ?? null,
        b.city ?? null,
        typeof b.notify_sms === 'boolean' ? b.notify_sms : null,
        typeof b.notify_push === 'boolean' ? b.notify_push : null,
        b.clear_district === true,
      ],
    );
    res.json({ user: publicUser(updated), voiceKey: 'profile_saved' });
  }),
);

/** Mes annonces (brouillons et publications hors ligne comprises). */
router.get(
  '/me/ads',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset } = readPage(req.query);
    const statuses = req.query.status
      ? String(req.query.status)
          .split(',')
          .filter((s) => OWNER_AD_STATUSES.includes(s))
      : null;
    const [items, stats] = await Promise.all([
      listOwnerAds(req.user.id, { statuses, limit, offset }),
      ownerStats(req.user.id),
    ]);
    res.json({ items, page: { limit, offset, count: items.length }, stats });
  }),
);

/** Statistiques du compte (badge confiance, vues, ventes). */
router.get(
  '/me/stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ stats: await ownerStats(req.user.id) });
  }),
);

/** Liste des utilisateurs bloques (ecran "Mon compte" > "Bloques"). */
router.get(
  '/me/blocked',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await many(
      `SELECT u.id, u.name, u.phone, u.avatar_key, u.phone_verified, b.created_at AS blocked_at
       FROM blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
      [req.user.id],
    );
    res.json({ items: rows });
  }),
);

/** Mes notifications (historique SMS / push). */
router.get(
  '/me/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset } = readPage(req.query);
    res.json({ items: await listNotifications(req.user.id, { limit, offset }) });
  }),
);

/** Abonnement push PWA. */
router.post(
  '/me/push-subscription',
  requireAuth,
  validateBody(
    z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string(), auth: z.string() }),
    }),
  ),
  asyncHandler(async (req, res) => {
    await saveSubscription({ userId: req.user.id, subscription: req.body, userAgent: req.headers['user-agent'] });
    res.status(201).json({ ok: true });
  }),
);

router.delete(
  '/me/push-subscription',
  requireAuth,
  validateBody(z.object({ endpoint: z.string().url() })),
  asyncHandler(async (req, res) => {
    await removeSubscription(req.body.endpoint);
    res.json({ ok: true });
  }),
);

/** Profil public (vue "vendeur" depuis une annonce). */
router.get(
  '/users/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (req.user && req.user.id === req.params.id) {
      const me = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
      return res.json({ user: publicUser(me) });
    }
    if (req.user && (await isBlocked(req.user.id, req.params.id))) {
      throw forbidden('user_blocked', 'Utilisateur indisponible', { voiceKey: 'error_blocked_target' });
    }
    const user = await one(
      `SELECT u.*, d.name AS district_name FROM users u
       LEFT JOIN districts d ON d.id = u.district_id
       WHERE u.id = $1 AND u.banned_at IS NULL`,
      [req.params.id],
    );
    if (!user) throw notFound('user_not_found', 'Utilisateur introuvable');
    const [stats, ratings] = await Promise.all([
      ownerStats(user.id),
      many(
        `SELECT id, stars, comment, audio_key, created_at FROM ratings
         WHERE ratee_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [user.id],
      ),
    ]);
    return res.json({ user: publicUser(user), stats, ratings });
  }),
);

/** Notation apres transaction (message vocal d'evaluation). */
router.post(
  '/users/:id/ratings',
  requireAuth,
  validateBody(
    z.object({
      stars: z.coerce.number().int().min(1).max(5),
      ad_id: z.string().uuid().optional(),
      audio_key: z.string().max(300).optional(),
      comment: z.string().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) {
      throw badRequest('cannot_rate_self', 'Vous ne pouvez pas vous noter vous-meme');
    }
    if (await isBlocked(req.user.id, req.params.id)) {
      throw forbidden('user_blocked', 'Utilisateur bloque', { voiceKey: 'error_blocked_target' });
    }
    const target = await one('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (!target) throw notFound('user_not_found', 'Utilisateur introuvable');

    const rating = await one(
      `INSERT INTO ratings (ad_id, rater_id, ratee_id, stars, audio_key, comment)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (ad_id, rater_id) WHERE ad_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        req.body.ad_id || null,
        req.user.id,
        req.params.id,
        req.body.stars,
        req.body.audio_key || null,
        req.body.comment || null,
      ],
    );
    if (!rating) throw badRequest('already_rated', 'Vous avez deja note cette transaction');
    res.status(201).json({ rating, voiceKey: 'rating_saved' });
  }),
);

/** Mes signalements envoyes (transparence). */
router.get(
  '/me/reports',
  requireAuth,
  validateQuery(z.object({ limit: z.coerce.number().optional(), offset: z.coerce.number().optional() })),
  asyncHandler(async (req, res) => {
    const { limit, offset } = readPage(req.query);
    const rows = await many(
      `SELECT id, target_type, target_id, reason_code, status, created_at FROM reports
       WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset],
    );
    res.json({ items: rows });
  }),
);

export default router;