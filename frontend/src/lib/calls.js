/**
 * Historique des appels : purement local (IndexedDB), le numero du vendeur
 * reste deja visible, aucun historique n'est envoye au serveur.
 * Toutes les ecritures sont silencieuses : en navigation privee ou si le
 * stockage est plein, l'application continue de fonctionner sans historique.
 */
import { idb } from './idb.js';
import { formatPhone, telLink } from './format.js';

const STORE = 'calls';

/** Taille maximale de l'historique (les plus anciens sont oublies). */
export const CALL_LOG_LIMIT = 60;

/** Nom du contact, sinon numero lisible (jamais de ligne vide). */
export function callLabel(entry = {}) {
  if (entry.name) return entry.name;
  const pretty = formatPhone(entry.phone);
  return pretty || entry.phone || '';
}

/** Identifiant stable d'un appel : un contact, a la seconde. */
export function callEntryId(phone, at = Date.now()) {
  return `${String(phone || '').replace(/[^\d+]/g, '')}-${Math.floor(Number(at) / 1000)}`;
}

/** Lien d'appel direct (tel:), aligne sur le formatage officiel des numeros. */
export function callLink(phone) {
  return telLink(phone);
}

/** Enregistre un appel lance depuis l'application (retourne null si impossible). */
export async function logCall({ name = null, phone, adId = null } = {}, at = Date.now()) {
  if (!phone) return null;
  const entry = { id: callEntryId(phone, at), name: name || null, phone, ad_id: adId || null, at };
  try {
    await idb.put(STORE, entry);
    await prune();
    return entry;
  } catch {
    return null;
  }
}

/** Appels du plus recent au plus ancien. */
export async function listCalls() {
  try {
    const rows = await idb.all(STORE);
    return (rows || []).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
  } catch {
    return [];
  }
}

/** Vide l'historique (bouton "Vider l'historique"). */
export async function clearCalls() {
  try {
    await idb.clear(STORE);
    return true;
  } catch {
    return false;
  }
}

/** Ne garde que les CALL_LOG_LIMIT appels les plus recents. */
async function prune() {
  const rows = await listCalls();
  for (const row of rows.slice(CALL_LOG_LIMIT)) {
    await idb.remove(STORE, row.id);
  }
}

export default { CALL_LOG_LIMIT, callLabel, callEntryId, callLink, logCall, listCalls, clearCalls };
