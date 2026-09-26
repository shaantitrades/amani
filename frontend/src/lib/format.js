/**
 * Formatage des nombres et des dates, optimise pour un usage vocal et visuel.
 */

/** 285000 -> "285 000 FCFA" (gros chiffres, espaces insecables). */
export function formatPrice(amount, currency = 'XAF') {
  if (amount === null || amount === undefined || amount === '') return '';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  const formatted = new Intl.NumberFormat('fr-FR').format(value).replace(/\u202f|\u00a0/g, ' ');
  const suffix = currency === 'XAF' ? ' FCFA' : currency === 'USD' ? ' $' : ` ${currency}`;
  return `${formatted}${suffix}`;
}

/** Version compacte pour les vignettes : 1,2 M / 285 K. */
export function formatPriceShort(amount, currency = 'XAF') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  const suffix = currency === 'XAF' ? ' F' : ' $';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} M${suffix}`;
  if (value >= 1000) return `${Math.round(value / 1000)} K${suffix}`;
  return `${value}${suffix}`;
}

/** Lecture vocale d'un prix : "deux cent quatre vingt cinq mille francs". */
export function priceToSpeech(amount, currency = 'XAF') {
  if (amount === null || amount === undefined) return '';
  const unit = currency === 'XAF' ? 'francs CFA' : currency === 'USD' ? 'dollars' : currency;
  return `${Number(amount)} ${unit}`;
}

/** "il y a 5 min", "hier", "12/03". */
export function relativeTime(dateInput, now = new Date()) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  const diffMs = now.getTime() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "a l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

/** Duree audio : 65 -> "1:05". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Taille de fichier lisible. */
export function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Numero de telephone formate pour l'affichage (+235 66 12 34 56).
 * Le numero n'est jamais masque : l'appel direct est une fonctionnalite cle.
 */
export function formatPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.startsWith('235')) {
    return `+235 ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
  }
  return phone;
}

/** Lien d'appel direct (tel:) - aucun masquage de numero. */
export function telLink(phone) {
  return `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;
}

/** Indicatif par defaut (Tchad) : sert de repli avant le chargement du referentiel. */
export const DEFAULT_DIAL_CODE = '235';

/**
 * Indicatif telephonique a afficher dans le formulaire d'inscription.
 * `/api/v1/bootstrap` peut ne pas etre encore charge (ou echoue hors ligne) :
 * on renvoie alors l'indicatif du marche pilote. Evite tout plantage d'ecran.
 */
export function dialCode(countries, fallback = DEFAULT_DIAL_CODE) {
  if (!Array.isArray(countries) || countries.length === 0) return fallback;
  const withDial = countries.find((country) => country && typeof country.dial === 'string' && country.dial);
  return withDial ? withDial.dial : fallback;
}

export default {
  formatPrice,
  formatPriceShort,
  priceToSpeech,
  relativeTime,
  formatDuration,
  formatBytes,
  formatPhone,
  telLink,
  dialCode,
  DEFAULT_DIAL_CODE,
};
