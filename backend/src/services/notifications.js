import { many, one, query } from '../lib/db.js';
import logger from '../lib/logger.js';
import { sendSms, renderTemplate } from './sms.js';
import { pushEnabled, sendPushToUser } from './push.js';

/**
 * File d'attente de notifications multicanales (SMS + push + vocal IVR Phase 2).
 *
 * Principe : on insere d'abord en base (status 'queued'), un worker relit la
 * file et envoie. Ainsi un redemarrage du conteneur ne perd aucune notification.
 */

export async function enqueueNotification({
  userId,
  channel,
  kind,
  title = null,
  body,
  voiceKey = null,
  payload = {},
  language = 'fr',
}) {
  return one(
    `INSERT INTO notifications (user_id, channel, kind, title, body, voice_key, payload, language)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [userId, channel, kind, title, body, voiceKey, JSON.stringify(payload), language],
  );
}

/**
 * Notifie un utilisateur en respectant ses preferences et en economisant les SMS.
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.kind
 * @param {string} opts.smsTemplate cle de modele SMS
 * @param {object} opts.smsVars
 * @param {string} opts.title
 * @param {string} opts.body corps du push (texte court)
 * @param {string} opts.voiceKey cle audio a jouer par la PWA
 * @param {object} opts.payload donnees de navigation (deep link)
 */
export async function notifyUser({
  userId,
  kind,
  smsTemplate = null,
  smsVars = {},
  title = null,
  body = '',
  voiceKey = null,
  payload = {},
  forceSms = false,
  smsDedupeMinutes = 0,
}) {
  const user = await one('SELECT id, phone, language, notify_sms, notify_push FROM users WHERE id = $1', [userId]);
  if (!user) return { sms: false, push: false };

  const language = user.language || 'fr';
  const results = { sms: false, push: false, smsSkipped: false };

  if (pushEnabled() && user.notify_push) {
    const row = await enqueueNotification({
      userId,
      channel: 'push',
      kind,
      title,
      body: body || (smsTemplate ? renderTemplate(smsTemplate, language, smsVars) : ''),
      voiceKey,
      payload,
      language,
    });
    results.push = Boolean(row);
  }

  if (smsTemplate && (forceSms || user.notify_sms)) {
    // Anti-spam SMS (le cout d'un SMS est significatif au Sahel) :
    // une seule alerte du meme type par utilisateur dans la fenetre donnee.
    if (smsDedupeMinutes > 0 && !forceSms) {
      const recent = await one(
        `SELECT 1 AS recent FROM notifications
         WHERE user_id = $1 AND kind = $2 AND channel = 'sms'
           AND created_at > now() - ($3::text || ' minutes')::interval
         LIMIT 1`,
        [userId, kind, String(smsDedupeMinutes)],
      );
      if (recent) {
        results.smsSkipped = true;
        return results;
      }
    }
    const text = renderTemplate(smsTemplate, language, smsVars);
    const row = await enqueueNotification({
      userId,
      channel: 'sms',
      kind,
      title,
      body: text,
      voiceKey,
      payload,
      language,
    });
    results.sms = Boolean(row);
  }

  return results;
}

/** Envoie les notifications en attente (appele par le worker). */
export async function dispatchQueued({ limit = 25 } = {}) {
  const rows = await many(
    `SELECT n.*, u.phone
     FROM notifications n
     JOIN users u ON u.id = n.user_id
     WHERE n.status = 'queued'
     ORDER BY n.created_at ASC
     LIMIT $1`,
    [limit],
  );

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (row.channel === 'sms') {
        await sendSms({ to: row.phone, body: row.body });
        sent += 1;
      } else if (row.channel === 'push') {
        const res = await sendPushToUser(row.user_id, {
          title: row.title || 'Bodogui',
          body: row.body,
          voiceKey: row.voice_key,
          data: row.payload,
        });
        if (res.skipped) {
          await query(`UPDATE notifications SET status = 'skipped', error = 'push_disabled' WHERE id = $1`, [row.id]);
          continue;
        }
        sent += res.sent > 0 ? 1 : 0;
        if (res.sent === 0) {
          failed += 1;
          await query(
            `UPDATE notifications SET status = 'failed', error = 'no_delivery', attempts = attempts + 1 WHERE id = $1`,
            [row.id],
          );
          continue;
        }
      } else {
        // Canal vocal (IVR) : hors perimetre MVP, on archive la demande.
        await query(`UPDATE notifications SET status = 'skipped', error = 'voice_ivr_not_enabled' WHERE id = $1`, [
          row.id,
        ]);
        continue;
      }
      await query(`UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [
        row.id,
      ]);
    } catch (err) {
      failed += 1;
      logger.warn({ err: err.message, id: row.id, channel: row.channel }, 'Notification en echec');
      await query(
        `UPDATE notifications
         SET attempts = attempts + 1,
             error = $2,
             status = CASE WHEN attempts + 1 >= 3
                           THEN 'failed'::notification_status
                           ELSE 'queued'::notification_status END
         WHERE id = $1`,
        [row.id, err.message?.slice(0, 250)],
      );
    }
  }

  return { processed: rows.length, sent, failed };
}

/** Liste des notifications d'un utilisateur (ecran "Mon compte" > notifications). */
export async function listNotifications(userId, { limit = 30, offset = 0 } = {}) {
  return many(
    `SELECT id, channel, kind, title, body, voice_key, payload, status, sent_at, created_at
     FROM notifications WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
}

export default { enqueueNotification, notifyUser, dispatchQueued, listNotifications };
