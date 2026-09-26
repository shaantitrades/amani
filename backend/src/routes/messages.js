import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../lib/db.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { limiters } from '../middleware/rateLimit.js';
import { readPage } from '../lib/pagination.js';
import { isBlocked } from '../services/blocks.js';
import { notifyUser } from '../services/notifications.js';

const router = Router();

/** Cle de conversation stable entre deux utilisateurs. */
export function threadKey(a, b) {
  return [a, b].sort().join('|');
}

/**
 * Envoyer un message vocal (ou texte) a un vendeur.
 * Le numero n'etant pas masque, le message vocal complete l'appel direct.
 */
router.post(
  '/messages',
  requireAuth,
  limiters.write(),
  validateBody(
    z.object({
      recipient_id: z.string().uuid(),
      ad_id: z.string().uuid().optional().nullable(),
      kind: z.enum(['voice', 'text']).default('voice'),
      audio_key: z.string().max(300).optional().nullable(),
      audio_seconds: z.coerce.number().int().min(1).max(60).optional().nullable(),
      transcript: z.string().max(2000).optional().nullable(),
      body: z.string().max(1000).optional().nullable(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (b.recipient_id === req.user.id) throw badRequest('self_message', 'Vous ne pouvez pas vous ecrire a vous-meme');
    if (b.kind === 'voice' && !b.audio_key) throw badRequest('audio_required', 'Message vocal manquant');
    if (b.kind === 'text' && !b.body) throw badRequest('body_required', 'Message vide');

    if (await isBlocked(req.user.id, b.recipient_id)) {
      throw forbidden('user_blocked', 'Envoi impossible', { voiceKey: 'error_blocked_target' });
    }
    const recipient = await one('SELECT id FROM users WHERE id = $1', [b.recipient_id]);
    if (!recipient) throw notFound('user_not_found', 'Destinataire introuvable');

    if (b.ad_id) {
      const ad = await one('SELECT id FROM ads WHERE id = $1', [b.ad_id]);
      if (!ad) throw notFound('ad_not_found', 'Annonce introuvable');
    }

    const message = await one(
      `INSERT INTO messages (ad_id, thread_key, sender_id, recipient_id, kind, audio_key, audio_seconds, transcript, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        b.ad_id || null,
        threadKey(req.user.id, b.recipient_id),
        req.user.id,
        b.recipient_id,
        b.kind,
        b.audio_key || null,
        b.audio_seconds || null,
        b.transcript || null,
        b.body || null,
      ],
    );

    await notifyUser({
      userId: b.recipient_id,
      kind: 'new_message',
      smsTemplate: 'ad_interest',
      smsVars: { category: b.transcript || 'votre annonce' },
      smsDedupeMinutes: 10,
      title: 'Nouveau message',
      body: b.transcript || 'Vous avez recu un message vocal.',
      voiceKey: 'new_message',
      payload: { messageId: message.id, adId: b.ad_id || null, fromUserId: req.user.id },
    });

    res.status(201).json({ message, voiceKey: 'interest_sent' });
  }),
);

/** Conversations (dernier message + compteur de non lus). */
router.get(
  '/messages/threads',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset } = readPage(req.query);
    const items = await many(
      `SELECT c.id AS last_message_id, c.created_at AS last_at, c.kind AS last_kind,
              c.audio_key AS last_audio_key, c.body AS last_body, c.transcript AS last_transcript,
              c.sender_id AS last_sender_id,
              u.id AS other_id, u.name AS other_name, u.phone AS other_phone, u.avatar_key AS other_avatar_key,
              (SELECT count(*)::int FROM messages m
                WHERE m.thread_key = t.thread_key AND m.recipient_id = $1 AND m.read_at IS NULL) AS unread
       FROM (
         SELECT thread_key, max(created_at) AS last_at
         FROM messages
         WHERE sender_id = $1 OR recipient_id = $1
         GROUP BY thread_key
         ORDER BY max(created_at) DESC
         LIMIT $2 OFFSET $3
       ) t
       JOIN LATERAL (
         SELECT * FROM messages m
         WHERE m.thread_key = t.thread_key AND (m.sender_id = $1 OR m.recipient_id = $1)
         ORDER BY m.created_at DESC LIMIT 1
       ) c ON true
       JOIN users u ON u.id = CASE WHEN c.sender_id = $1 THEN c.recipient_id ELSE c.sender_id END
       ORDER BY t.last_at DESC`,
      [req.user.id, limit, offset],
    );
    res.json({ items });
  }),
);

/** Messages echanges avec un utilisateur (marques comme lus). */
router.get(
  '/messages/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (await isBlocked(req.user.id, req.params.userId)) {
      throw forbidden('user_blocked', 'Conversation indisponible', { voiceKey: 'error_blocked_target' });
    }
    const key = threadKey(req.user.id, req.params.userId);
    const { limit, offset } = readPage(req.query);
    const items = await many(
      `SELECT * FROM messages WHERE thread_key = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [key, limit, offset],
    );
    await query(`UPDATE messages SET read_at = now() WHERE thread_key = $1 AND recipient_id = $2 AND read_at IS NULL`, [
      key,
      req.user.id,
    ]);
    res.json({ items });
  }),
);

/** Signaler un message abusif (alimente la moderation). */
router.post(
  '/messages/:id/report',
  requireAuth,
  asyncHandler(async (req, res) => {
    const message = await one(
      `SELECT m.* FROM messages m WHERE m.id = $1 AND (m.recipient_id = $2 OR m.sender_id = $2)`,
      [req.params.id, req.user.id],
    );
    if (!message) throw notFound('message_not_found', 'Message introuvable');
    const other = message.sender_id === req.user.id ? message.recipient_id : message.sender_id;
    await query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason_code, comment)
       VALUES ($1, 'user', $2, 'spam', 'Message vocal signale')
       ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [req.user.id, other],
    );
    res.status(201).json({ reported: true, voiceKey: 'reported', otherUserId: other });
  }),
);

export default router;