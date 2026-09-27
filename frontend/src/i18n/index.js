import fr from './strings/fr.js';
import ar from './strings/ar.js';
import ff from './strings/ff.js';
import { VOICE_PROMPT_TEXT, VOICE_PROMPT_KEYS } from './strings/voice.js';

/**
 * Internationalisation Bodogui.
 * Toute cle absente d'une langue retombe sur le francais : jamais de texte vide.
 * Trois langues pilotes : francais, arabe tchadien, fulfulde. Le sara a ete
 * retire du produit (libelles et messages vocaux non valides par des natifs).
 */

export const LANGUAGES = [
  { code: 'fr', label: 'Francais', native: 'Français', flag: '🇫🇷', dir: 'ltr', tts: 'fr-FR' },
  { code: 'ar', label: 'Arabe tchadien', native: 'عربي', flag: '🇹🇩', dir: 'rtl', tts: 'ar-SA' },
  { code: 'ff', label: 'Fulfulde', native: 'Fulfulde', flag: '🇹🇩', dir: 'ltr', tts: 'fr-FR' },
];

export const DEFAULT_LANGUAGE = 'fr';

const TABLES = { fr, ar, ff };

export function t(lang, key) {
  const table = TABLES[lang] || TABLES.fr;
  // Les messages d'erreur (error_*) vivent dans strings/voice.js, le miroir des
  // messages vocaux de l'API : sans ce repli, un toast afficherait la cle brute
  // (« error_generic ») au lieu d'un texte comprehensible.
  return table[key] || fr[key] || VOICE_PROMPT_TEXT[key] || key;
}

export function languageMeta(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

export function isSupportedLanguage(code) {
  return Boolean(TABLES[code]);
}

/** Chemin du message vocal systeme (fichier Opus enregistre par un natif). */
export function promptUrl(key, lang = DEFAULT_LANGUAGE) {
  const language = TABLES[lang] ? lang : DEFAULT_LANGUAGE;
  return `/voice/${language}/${key}.opus`;
}

/** Texte de repli (synthese vocale du navigateur, accessibilite, tests). */
export function promptText(key) {
  return VOICE_PROMPT_TEXT[key] || VOICE_PROMPT_TEXT.error_generic;
}

export function categoryLabel(category, lang) {
  if (!category) return '';
  return category[`label_${lang}`] || category.label_fr || category.code;
}

export function districtLabel(district, lang) {
  if (!district) return '';
  return (lang === 'ar' ? district.name_ar : null) || district.name;
}

export { VOICE_PROMPT_TEXT, VOICE_PROMPT_KEYS };

export default { LANGUAGES, t, promptUrl, promptText, categoryLabel, districtLabel, languageMeta };
