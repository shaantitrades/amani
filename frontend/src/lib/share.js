/**
 * Partage d'une annonce (WhatsApp, partage natif du telephone, copie du lien).
 *
 * Principe produit : qui recoit le lien doit s'inscrire pour voir l'annonce
 * (les annonces ne sont pas publiques). Le texte partage est donc ecrit de
 * facon a donner envie d'ouvrir l'application.
 */

export function defaultOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** Lien public et stable d'une annonce : https://bodogui.com/ad/<id> */
export function adShareUrl(adId, origin = defaultOrigin()) {
  if (!adId) return origin || '';
  return `${String(origin).replace(/\/$/, '')}/ad/${adId}`;
}

/**
 * Texte du message partage (court, lisible, sans prix si inconnu).
 * @param {{title?: string, price_label?: string, district_name?: string}} ad
 */
export function adShareText(ad = {}, url = '') {
  const parts = [];
  const title = ad.title || ad.category_label || 'Annonce Bodogui';
  parts.push(`🛒 ${title}`);
  if (ad.price_label) parts.push(`💰 ${ad.price_label}`);
  if (ad.district_name) parts.push(`📍 ${ad.district_name}`);
  parts.push('Voir la photo et ecouter la description sur Bodogui :');
  if (url) parts.push(url);
  return parts.join('\n');
}

/** Lien WhatsApp (sans destinataire : l'utilisateur choisit le contact). */
export function whatsappShareLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text || '')}`;
}

/** Le telephone supporte-t-il le partage natif (Android : menu de partage) ? */
export function canNativeShare(win = typeof window === 'undefined' ? null : window) {
  return Boolean(win?.navigator?.share);
}

/**
 * Ouvre le partage natif ; renvoie false si indisponible (le client propose
 * alors WhatsApp ou la copie du lien).
 */
export async function shareNatively({ title, text, url }) {
  if (!canNativeShare()) return false;
  try {
    await window.navigator.share({ title, text, url });
    return true;
  } catch {
    return false; // l'utilisateur a annule ou le partage a echoue : on continue
  }
}

/** Copie le lien dans le presse-papiers (repli quand le partage natif manque). */
export async function copyToClipboard(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* on tente l'ancienne methode */
  }
  try {
    const input = document.createElement('input');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

export default {
  adShareUrl,
  adShareText,
  whatsappShareLink,
  canNativeShare,
  shareNatively,
  copyToClipboard,
};
