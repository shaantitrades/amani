/**
 * Notifications vues : le serveur ne stocke pas d'etat "lu" (la table
 * notifications est un journal d'envoi). On garde donc un marqueur local, ce
 * qui permet un badge facon WhatsApp sans requete supplementaire.
 */
import { cacheGet, cacheSet } from './idb.js';

const SEEN_KEY = 'notifications:seen';

/** Horodatage (ms) de la derniere consultation de l'ecran Notifications. */
export async function notificationsSeenAt() {
  const value = await cacheGet(SEEN_KEY);
  return Number(value) || 0;
}

/**
 * Date (ms) de l'alerte la plus recente, 0 s'il n'y en a aucune.
 * On utilise l'heure du serveur : le badge reste juste meme si l'horloge du
 * telephone est decalee.
 */
export function newestAlertAt(items = []) {
  return (items || []).reduce((max, item) => {
    const time = new Date(item?.created_at || 0).getTime();
    return Number.isFinite(time) && time > max ? time : max;
  }, 0);
}

/**
 * Marque l'ecran Notifications comme consulte (badge remis a zero).
 * Sans alerte (hors ligne) : on retombe sur l'heure locale.
 */
export async function markNotificationsSeen(items = [], fallback = Date.now()) {
  const at = newestAlertAt(items) || fallback;
  await cacheSet(SEEN_KEY, at);
  return at;
}

/** Nombre d'elements plus recents que le marqueur (fonction pure, testable). */
export function countUnread(items = [], seenAt = 0) {
  return (items || []).filter((item) => {
    const time = new Date(item?.created_at || 0).getTime();
    return Number.isFinite(time) && time > (Number(seenAt) || 0);
  }).length;
}

export default { notificationsSeenAt, markNotificationsSeen, countUnread, newestAlertAt };
