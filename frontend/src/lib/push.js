import { api } from './api.js';

/**
 * Notifications push PWA (VAPID).
 * Optionnel : si le navigateur ne supporte pas ou si l'utilisateur refuse,
 * l'application continue de fonctionner (les SMS prennent le relais).
 */

export function pushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Demande l'autorisation et enregistre l'abonnement cote serveur.
 * @param {string} vapidPublicKey cle publique exposee par /api/v1/bootstrap
 */
export async function registerPush(vapidPublicKey) {
  if (!pushSupported() || !vapidPublicKey) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const json = subscription.toJSON();
  await api.post('/me/push-subscription', { endpoint: json.endpoint, keys: json.keys });
  localStorage.setItem('bodogui.push.endpoint', json.endpoint);
  return { ok: true };
}

export async function unregisterPush() {
  const endpoint = localStorage.getItem('bodogui.push.endpoint');
  if (endpoint) {
    await api.del('/me/push-subscription', { body: { endpoint } }).catch(() => {});
    localStorage.removeItem('bodogui.push.endpoint');
  }
  if (!pushSupported()) return { ok: false };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  return { ok: true };
}

/** Enregistre le service worker (injecte par vite-plugin-pwa en production). */
export async function ensureServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export default { pushSupported, registerPush, unregisterPush, ensureServiceWorker };
