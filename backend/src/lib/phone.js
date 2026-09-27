/**
 * Normalisation des numeros de telephone (E.164).
 * Marche pilote : Tchad (+235). Pays voisins prevus en Phase 3.
 */

export const COUNTRIES = [
  { code: 'TD', dial: '235', name: 'Tchad', digits: 8, languages: ['fr', 'ar', 'ff'] },
  { code: 'CM', dial: '237', name: 'Cameroun', digits: 9, languages: ['fr', 'en'] },
  { code: 'NE', dial: '227', name: 'Niger', digits: 8, languages: ['fr', 'ff'] },
  { code: 'ML', dial: '223', name: 'Mali', digits: 8, languages: ['fr', 'ff'] },
  { code: 'BF', dial: '226', name: 'Burkina Faso', digits: 8, languages: ['fr', 'ff'] },
  { code: 'CF', dial: '236', name: 'Centrafrique', digits: 8, languages: ['fr'] },
];

const DIAL_CODES = COUNTRIES.map((c) => c.dial);

/**
 * Normalise un numero saisi par l'utilisateur (le plus tolerant possible :
 * espaces, tirets, parentheses, prefixe local "66 12 34 56", "0066..", "+235..").
 * @param {string} input
 * @param {{ defaultCountry?: string }} [opts]
 * @returns {{ ok: boolean, e164?: string, error?: string }}
 */
export function normalizePhone(input, opts = {}) {
  const defaultCountry = opts.defaultCountry || 'TD';
  const fallback = COUNTRIES.find((c) => c.code === defaultCountry) || COUNTRIES[0];

  if (typeof input !== 'string') return { ok: false, error: 'phone_not_string' };

  let s = input
    .replace(/[\s\u00a0().\-/]/g, '')
    .replace(/[^\d+]/g, '');

  if (!s) return { ok: false, error: 'phone_empty' };

  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    const dial = DIAL_CODES.find((d) => digits.startsWith(d));
    if (!dial) return { ok: false, error: 'phone_unknown_country' };
    const country = COUNTRIES.find((c) => c.dial === dial);
    const local = digits.slice(dial.length);
    if (local.length !== country.digits) return { ok: false, error: 'phone_bad_length' };
    return { ok: true, e164: `+${dial}${local}`, country: country.code };
  }

  // Numero local sans indicatif
  if (s.length === fallback.digits) {
    return { ok: true, e164: `+${fallback.dial}${s}`, country: fallback.code };
  }
  // Numero local avec zero initial (ex: 066123456)
  const noZero = s.replace(/^0+/, '');
  if (noZero.length === fallback.digits) {
    return { ok: true, e164: `+${fallback.dial}${noZero}`, country: fallback.code };
  }
  // Numero avec indicatif sans "+"
  const dial = DIAL_CODES.find((d) => s.startsWith(d) && s.length === d.length + fallback.digits);
  if (dial) {
    const country = COUNTRIES.find((c) => c.dial === dial);
    return { ok: true, e164: `+${s}`, country: country.code };
  }
  return { ok: false, error: 'phone_invalid' };
}

export function isValidPhone(input, opts) {
  return normalizePhone(input, opts).ok;
}

/**
 * Analyse une liste de numeros separes par des virgules (variable
 * d'environnement) et ne conserve que les numeros valides, en E.164.
 * Utilise pour la liste de test (`TEST_LOGIN_PHONES`).
 * @param {string} raw
 * @returns {string[]}
 */
export function parsePhoneList(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const numbers = [];
  for (const item of raw.split(',')) {
    const normalized = normalizePhone(item.trim());
    if (normalized.ok && !numbers.includes(normalized.e164)) numbers.push(normalized.e164);
  }
  return numbers;
}

/** Affichage lisible : +235 66 12 34 56 */
export function formatPhone(e164) {
  if (!e164 || !e164.startsWith('+')) return e164 || '';
  const digits = e164.slice(1);
  const country = COUNTRIES.find((c) => digits.startsWith(c.dial) && digits.length === c.dial.length + c.digits);
  if (!country) return e164;
  const local = digits.slice(country.dial.length);
  const groups = country.code === 'TD' ? [2, 2, 2, 2] : [3, 3, 3];
  const parts = [];
  let i = 0;
  for (const g of groups) {
    if (i >= local.length) break;
    parts.push(local.slice(i, i + g));
    i += g;
  }
  return `+${country.dial} ${parts.join(' ')}`;
}

/** Numero pret pour un lien tel: (sans espaces ni separateurs) */
export function dialable(e164) {
  return (e164 || '').replace(/[^\d+]/g, '');
}
