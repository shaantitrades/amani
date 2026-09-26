/**
 * Conversation interne (remplace le renvoi vers WhatsApp).
 *
 * Principe produit : parler au vendeur se fait **dans Bodogui**. Le bouton
 * DISCUTER de la fiche annonce ouvre la conversation de l'application
 * (`/messages/<vendeur>`), qui n'existe que pour un compte inscrit : un lien
 * partage conduit donc d'abord a l'inscription, puis revient sur l'annonce.
 * Logique pure, testable sans DOM.
 */

import { adShareUrl, defaultOrigin } from './share.js';

/** Chemin de la conversation avec un utilisateur (vendeur ou acheteur). */
export function chatPath(userId) {
  return userId ? `/messages/${userId}` : '/messages';
}

/**
 * Contexte transmis a l'ecran de conversation quand on part d'une annonce :
 * au premier message le fil est vide, l'en-tete a donc besoin du nom du
 * vendeur, de son numero et de l'annonce concernee (notifiee au vendeur).
 * `adUrl` est joint a l'accroche : le vendeur retrouve l'annonce d'un appui,
 * meme si le titre est court ou ambigu.
 */
export function chatStateFromAd(ad = {}, origin = defaultOrigin()) {
  const adId = ad.id || null;
  return {
    fromAd: true,
    name: ad.owner_name || null,
    phone: ad.owner_phone || null,
    adId,
    adTitle: ad.title || null,
    adUrl: adId ? adShareUrl(adId, origin) : null,
  };
}

/**
 * Gabarit par defaut (les fichiers de langue fournissent le leur).
 * `{title}` : titre de l'annonce ; `{link}` : lien de l'annonce, sur sa propre
 * ligne pour rester lisible et tappable dans la bulle.
 */
export const AD_INTRO_TEMPLATE =
  "Bonjour, votre annonce « {title} » m'interesse. Est-elle toujours disponible ?\n{link}";

/** Meme phrase sans titre d'annonce : repli lisible et sans guillemets vides. */
export const AD_INTRO_NO_TITLE = "Bonjour, votre annonce m'interesse. Est-elle toujours disponible ?";

/** Nettoie une phrase : espaces doubles, lignes vides et bords. */
function tidy(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Premier message pre-rempli dans le champ de saisie quand on ecrit depuis une
 * annonce : un seul appui suffit a un utilisateur qui lit peu. La phrase porte
 * aussi le **lien de l'annonce**, pour que le vendeur voie exactement de quelle
 * annonce il s'agit.
 * Le gabarit contient `{title}` et `{link}` ; sans titre ni lien connus, la
 * phrase reste propre (pas de guillemets vides ni de ligne vide).
 */
export function adIntroText(ad = {}, template = AD_INTRO_TEMPLATE) {
  const title = String(ad.title || '').trim();
  const url = String(ad.url || '').trim();
  let message = String(template || '');
  if (message.includes('{title}')) {
    message = title ? message.replace('{title}', title) : message.replace(/[«»]|\{title\}/g, '');
  }
  if (message.includes('{link}')) {
    message = message.replace('{link}', url);
  } else if (url) {
    // Gabarit traduit sans emplacement de lien : on le pose a la fin.
    message = `${message}\n${url}`;
  }
  return tidy(message);
}

/** Un lien http(s) dans un texte (collé ou entouré de texte). */
const LINK_PATTERN = /(https?:\/\/[^\s]+)/g;

/**
 * Decoupe un message en morceaux texte / lien : l'ecran de conversation peut
 * ainsi rendre le lien de l'annonce cliquable au lieu de l'afficher en brut.
 * @returns {Array<{type: 'text'|'link', value: string}>}
 */
export function splitLinks(text) {
  const value = String(text || '');
  if (!value) return [];
  return value
    .split(LINK_PATTERN)
    .filter((part) => part !== '')
    .map((part) => (/^https?:\/\//.test(part) ? { type: 'link', value: part } : { type: 'text', value: part }));
}

/**
 * Chemin interne d'un lien de l'application (`https://bodogui.com/ad/12` ->
 * `/ad/12`), pour ouvrir l'annonce dans l'application au lieu de recharger la
 * page. Renvoie `null` pour tout autre site : pas de lien externe detourne.
 */
export function localPathFromUrl(url, origin = defaultOrigin()) {
  const value = String(url || '').trim();
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  const base = String(origin || '').replace(/\/+$/, '');
  if (!base || !value.startsWith(`${base}/`)) return null;
  const path = value.slice(base.length);
  return path.startsWith('/') && !path.startsWith('//') ? path : null;
}

/**
 * Ecran a rouvrir apres inscription : le visiteur qui a recu un lien partage
 * revient sur l'annonce (et peut enfin discuter), les autres vont a l'accueil.
 * Toute valeur non locale (`http://`, `//`) est ignoree : pas de redirection
 * ouverte.
 */
export function afterLoginPath(from, fallback = '/home') {
  if (typeof from !== 'string') return fallback;
  if (!from.startsWith('/') || from.startsWith('//')) return fallback;
  return from;
}

export default { chatPath, chatStateFromAd, adIntroText, splitLinks, localPathFromUrl, afterLoginPath };
