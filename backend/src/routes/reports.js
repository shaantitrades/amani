import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../lib/db.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { notifyUser } from '../services/notifications.js';
import { blockUser } from '../services/blocks.js';

const router = Router();

export const REPORT_REASONS = [
  { code: 'scam', label_fr: 'Arnaque / fraude', voiceKey: 'report_reason_scam' },
  { code: 'illegal', label_fr: 'Produit interdit', voiceKey: 'report_reason_illegal' },
  { code: 'nudity', label_fr: 'Image choquante', voiceKey: 'report_reason_nudity' },
  { code: 'duplicate', label_fr: 'Annonce repetee', voiceKey: 'report_reason_duplicate' },
  { code: 'spam', label_fr: 'Spam', voiceKey: 'report_reason_spam' },
  { code: 'other', label_fr: 'Autre probleme', voiceKey: 'report_reason_other' },
];

/** Liste des motifs (grille d'icones cote client). */
router.get('/reports/reasons', (req, res) => {
  res.json({ items: REPORT_REASONS });
});

/**
 * Signaler une annonce / un utilisateur / un groupe.
 * Le client propose ensuite de bloquer l'utilisateur (retour vocal).
 */
router.post(
  '/reports',
  requireAuth,
  validateBody(
    z.object({
      target_type: z.enum(['ad', 'user', 'group']),
      target_id: z.string().uuid(),
      reason_code: z.enum(['scam', 'illegal', 'nudity', 'duplicate', 'spam', 'other']),
      comment: z.string().max(500).optional(),
      comment_audio_key: z.string().max(300).optional(),
      block_user: z.boolean().optional().default(false),
    }),
  ),
  asyncHandler(async (req, res) => {
    const b = req.body;

    // Resolution du proprietaire concerne (pour le blocage et la notification)
    let ownerId = null;
    if (b.target_type === 'ad') {
      const ad = await one('SELECT id, owner_id, title, reports_count FROM ads WHERE id = $1', [b.target_id]);
      if (!ad) throw notFound('ad_not_found', 'Annonce introuvable');
      ownerId = ad.owner_id;
    } else if (b.target_type === 'user') {
      ownerId = b.target_id;
    } else {
      const g = await one('SELECT owner_id FROM groups WHERE id = $1', [b.target_id]);
      if (!g) throw notFound('group_not_found', 'Groupe introuvable');
      ownerId = g.owner_id;
    }
    if (ownerId === req.user.id) throw badRequest('cannot_report_self', 'Vous ne pouvez pas vous signaler');

    const report = await query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason_code, comment, comment_audio_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (reporter_id, target_type, target_id) DO UPDATE
         SET reason_code = EXCLUDED.reason_code, comment = EXCLUDED.comment, status = 'open'
       RETURNING *`,
      [
        req.user.id,
        b.target_type,
        b.target_id,
        b.reason_code,
        b.comment || null,
        b.comment_audio_key || null,
      ],
    );

    let autoHidden = false;
    if (b.target_type === 'ad') {
      const updated = await one(
        `UPDATE ads SET reports_count = (SELECT count(*)::int FROM reports WHERE target_type = 'ad' AND target_id = $1)
         WHERE id = $1 RETURNING reports_count, status`,
        [b.target_id],
      );
      // Masquage automatique au-dela du seuil configure (FRAUD_AUTO_HIDE_REPORTS)
      const threshold = Number(process.env.FRAUD_AUTO_HIDE_REPORTS || 3);
      if (updated && updated.reports_count >= threshold && updated.status === 'published') {
        await one(`UPDATE ads SET status = 'pending', moderation_note = 'Masquee automatiquement (signalements)' WHERE id = $1`, [
          b.target_id,
        ]);
        autoHidden = true;
      }
    }

    // Notifier les moderateurs (comptes is_admin)
    const admins = await query('SELECT id FROM users WHERE is_admin = true LIMIT 20');
    for (const admin of admins.rows) {
      await notifyUser({
        userId: admin.id,
        kind: 'report',
        title: 'Nouveau signalement',
        body: `Signalement ${b.reason_code} sur ${b.target_type}`,
        payload: { reportId: report.rows[0].id, target_type: b.target_type, target_id: b.target_id },
      }).catch(() => {});
    }

    let blocked = false;
    if (b.block_user && ownerId) {
      await blockUser({ blockerId: req.user.id, blockedId: ownerId, reason: `report:${b.reason_code}` });
      blocked = true;
    }

    res.status(201).json({
      report: report.rows[0],
      blocked,
      autoHidden,
      voiceKey: blocked ? 'reported_and_blocked' : 'reported',
      nextVoiceKey: 'report_and_block',
    });
  }),
);

export default router;
