import webpush from 'web-push';
import env from '../config/env.js';
import { many, query } from '../lib/db.js';
import logger from '../lib/logger.js';

/**
 * Notifications push PWA (VAPID). Optionnel : si les cles ne sont pas definies,
 * le canal push est simplement ignore (le SMS prend le relais).
 */
let configured = false;

export function pushEnabled() {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function initPush() {
  if (!pushEnabled()) {
    logger.warn('Push desactive : VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non definies');
    return false;
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export async function saveSubscription({ userId, subscription, userAgent }) {
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('Abonnement push invalide');
  }
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [userId, endpoint, keys.p256dh, keys.auth, userAgent?.slice(0, 250) || null],
  );
  return true;
}

export async function removeSubscription(endpoint) {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

/**
 * Envoie une notification push a toutes les sessions d'un utilisateur.
 * Les abonnements expires (404/410) sont supprimes automatiquement.
 */
export async function sendPushToUser(userId, payload) {
  if (!configured) return { sent: 0, failed: 0, skipped: true };
  const subs = await many('SELECT * FROM push_subscriptions WHERE user_id = $1', [userId]);
  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 86400, urgency: payload.urgency || 'normal' },
      );
      sent += 1;
      await query('UPDATE push_subscriptions SET last_used_at = now() WHERE id = $1', [sub.id]);
    } catch (err) {
      failed += 1;
      if ([404, 410].includes(err?.statusCode)) {
        await removeSubscription(sub.endpoint);
      } else {
        logger.warn({ err: err.message, userId }, 'Echec envoi push');
      }
    }
  }
  return { sent, failed };
}

export default { initPush, sendPushToUser, saveSubscription, removeSubscription, pushEnabled };
