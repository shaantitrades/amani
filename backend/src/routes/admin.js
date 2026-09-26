import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../lib/db.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { activeBanCondition } from '../lib/visibility.js';
import { pushEnabled } from '../services/push.js';
import { dispatchQueued } from '../services/notifications.js';
import { purgeExpiredOtp } from '../services/otp.js';
import { notifyUser } from '../services/notifications.js';

const router = Router();

/** Middleware : reserve aux administrateurs plateforme. */
function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return next(forbidden('admin_only', 'Reserve aux administrateurs'));
  return next();
}

router.use(requireAuth, requireAdmin);

/** Tableau de bord moderation : signalements ouverts, annonces suspectes, bannis. */
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const [reports, suspectAds, bannedUsers, stats] = await Promise.all([
      many(
        `SELECT r.*, u.name AS reporter_name, u.phone AS reporter_phone
         FROM reports r JOIN users u ON u.id = r.reporter_id
         WHERE r.status = 'open' ORDER BY r.created_at ASC LIMIT 50`,
      ),
      many(
        `SELECT a.id, a.title, a.status, a.reports_count, a.created_at,
                a.owner_id, u.phone AS owner_phone
         FROM ads a JOIN users u ON u.id = a.owner_id
         WHERE a.status = 'pending' OR a.reports_count > 0
         ORDER BY a.reports_count DESC, a.created_at DESC LIMIT 50`,
      ),
      many(
        `SELECT u.id, u.phone, u.name, u.ban_reason, u.ban_expires_at, u.banned_at
         FROM users u WHERE ${activeBanCondition('u')} ORDER BY u.banned_at DESC LIMIT 50`,
      ),
      one(
        `SELECT
           (SELECT count(*)::int FROM users) AS users,
           (SELECT count(*)::int FROM ads WHERE status = 'published') AS published_ads,
           (SELECT count(*)::int FROM groups WHERE is_active) AS groups,
           (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports,
           (SELECT count(*)::int FROM notifications WHERE status = 'queued') AS queued_notifications`,
      ),
    ]);
    res.json({ reports, suspectAds, bannedUsers, stats, pushEnabled: pushEnabled() });
  }),
);

/** Traitement d'un signalement : reviewed | actioned | dismissed. */
router.patch(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ status: z.enum(['reviewed', 'actioned', 'dismissed']), note: z.string().max(500).optional() })
      .parse(req.body);
    const report = await one(
      `UPDATE reports SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id, body.status, req.user.id],
    );
    if (!report) throw notFound('report_not_found', 'Signalement introuvable');
    res.json({ report });
  }),
);

/** Masquer / restaurer / supprimer une annonce (moderation). */
router.post(
  '/ads/:id/moderate',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ action: z.enum(['hide', 'restore', 'delete']), note: z.string().max(500).optional() })
      .parse(req.body);
    const status = { hide: 'rejected', restore: 'published', delete: 'deleted' }[body.action];
    const ad = await one(`UPDATE ads SET status = $2, moderation_note = $3 WHERE id = $1 RETURNING id, status`, [
      req.params.id,
      status,
      body.note || null,
    ]);
    if (!ad) throw notFound('ad_not_found', 'Annonce introuvable');
    await one(`INSERT INTO audit_log (actor_id, action, target_type, target_id, meta) VALUES ($1, $2, 'ad', $3, $4)`, [
      req.user.id,
      `moderation_${body.action}`,
      req.params.id,
      JSON.stringify({ note: body.note || null }),
    ]);
    res.json({ ad });
  }),
);

/**
 * Bannissement d'un utilisateur (temporaire ou definitif).
 * SMS + message vocal : "Votre compte a ete suspendu. Contactez le support."
 */
router.post(
  '/users/:id/ban',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        reason: z.string().min(3).max(300),
        days: z.coerce.number().int().min(1).max(3650).optional(),
      })
      .parse(req.body);
    if (req.params.id === req.user.id) throw badRequest('cannot_ban_self', 'Vous ne pouvez pas vous bannir');

    const target = await one('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (!target) throw notFound('user_not_found', 'Utilisateur introuvable');

    await one(
      `INSERT INTO bans (user_id, reason, expires_at, created_by)
       VALUES ($1, $2, CASE WHEN $3::int IS NULL THEN NULL ELSE now() + ($3 || ' days')::interval END, $4)`,
      [req.params.id, body.reason, body.days ?? null, req.user.id],
    );
    await one(
      `UPDATE users
       SET banned_at = now(), ban_reason = $2,
           ban_expires_at = CASE WHEN $3::int IS NULL THEN NULL ELSE now() + ($3 || ' days')::interval END
       WHERE id = $1`,
      [req.params.id, body.reason, body.days ?? null],
    );
    await one('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
      req.params.id,
    ]);
    await one(`INSERT INTO audit_log (actor_id, action, target_type, target_id, meta) VALUES ($1, 'ban', 'user', $2, $3)`, [
      req.user.id,
      req.params.id,
      JSON.stringify({ reason: body.reason, days: body.days ?? null }),
    ]);

    await notifyUser({
      userId: req.params.id,
      kind: 'ban',
      smsTemplate: 'ban',
      forceSms: true,
      title: 'Compte suspendu',
      body: 'Votre compte a ete suspendu. Contactez le support.',
      voiceKey: 'account_banned',
      payload: { reason: body.reason },
    });

    res.json({ banned: true, voiceKey: 'account_banned' });
  }),
);

/** Levee du bannissement. */
router.post(
  '/users/:id/unban',
  asyncHandler(async (req, res) => {
    await one('UPDATE users SET banned_at = NULL, ban_reason = NULL, ban_expires_at = NULL WHERE id = $1', [
      req.params.id,
    ]);
    await one('UPDATE bans SET lifted_at = now() WHERE user_id = $1 AND lifted_at IS NULL', [req.params.id]);
    await one(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES ($1, 'unban', 'user', $2)`, [
      req.user.id,
      req.params.id,
    ]);
    res.json({ unbanned: true });
  }),
);

/** Promotion d'un moderateur. */
router.post(
  '/users/:id/promote',
  asyncHandler(async (req, res) => {
    const user = await one('UPDATE users SET is_admin = true WHERE id = $1 RETURNING id, phone, is_admin', [
      req.params.id,
    ]);
    if (!user) throw notFound('user_not_found', 'Utilisateur introuvable');
    res.json({ user });
  }),
);

/** Purge des codes OTP expires (cron Coolify). */
router.post(
  '/maintenance/purge-otp',
  asyncHandler(async (req, res) => {
    res.json({ deleted: await purgeExpiredOtp() });
  }),
);

/** Relance l'envoi des notifications en attente. */
router.post(
  '/maintenance/dispatch-notifications',
  asyncHandler(async (req, res) => {
    res.json(await dispatchQueued({ limit: 100 }));
  }),
);

export default router;