/**
 * Catalogue des messages vocaux du systeme.
 *
 * Chaque cle correspond a un fichier audio enregistre par un natif :
 *   /voice/<langue>/<cle>.opus
 * (voir docs/VOICE_PROMPTS.md pour le guide d'enregistrement)
 *
 * Tant que les fichiers ne sont pas enregistres, le client bascule sur :
 *   1. la synthese vocale du navigateur (si disponible),
 *   2. un bip court (jamais de silence).
 */

export const LANGUAGES = [
  { code: 'fr', label: 'Francais', native: 'Français', dir: 'ltr', flag: '🇫🇷', tts: 'fr-FR' },
  { code: 'ar', label: 'Arabe tchadien', native: 'عربي', dir: 'rtl', flag: '🇹🇩', tts: 'ar-SA' },
  { code: 'ff', label: 'Fulfulde', native: 'Fulfulde', dir: 'ltr', flag: '🇹🇩', tts: 'fr-FR' },
  { code: 'sar', label: 'Sara', native: 'Sara', dir: 'ltr', flag: '🇹🇩', tts: 'fr-FR' },
];

export const DEFAULT_LANGUAGE = 'fr';

/** Cle -> phrase francaise de repli (sert aussi de script d'enregistrement). */
export const VOICE_PROMPTS = {
  welcome: 'Bienvenue sur Bodogui. Vendez et achetez pres de chez vous.',
  choose_language: 'Choisissez votre langue.',
  photo_added: 'Photo ajoutee.',
  photos_done: 'Photos terminees.',
  recording_start: 'Parlez maintenant.',
  recording_stop: 'Message enregistre.',
  recording_too_long: 'C\'est trop long. Parlez moins de soixante secondes.',
  price_saved: 'Prix enregistre.',
  location_saved: 'Localisation enregistree.',
  category_selected: 'Categorie choisie.',
  ad_published: 'Votre annonce est publiee. Vous recevrez un SMS si quelqu\'un est interesse.',
  ad_deleted: 'Annonce supprimee.',
  ad_updated: 'Annonce modifiee.',
  ad_sold: 'Annonce marquee comme vendue. Felicitations.',
  ad_saved_offline: 'Pas de reseau. Votre annonce sera publiee des que la connexion revient.',
  interest_sent: 'Votre message vocal a ete envoye au vendeur.',
  blocked: 'Utilisateur bloque. Vous ne verrez plus ses annonces.',
  unblocked: 'Utilisateur debloque.',
  reported: 'Signalement envoye. Merci de nous aider a proteger la communaute.',
  report_and_block: 'Voulez-vous aussi bloquer cet utilisateur ?',
  call_started: 'Appel en cours.',
  nothing_found: 'Aucune annonce trouvee. Essayez une autre categorie.',
  voice_search_hint: 'Dites ce que vous cherchez.',
  group_created: 'Groupe cree. Vous etes administrateur.',
  member_banned: 'Membre exclu du groupe.',
  post_deleted: 'Publication supprimee.',
  account_banned: 'Votre compte a ete suspendu. Contactez le support.',
  safety_warning: 'Ne payez jamais avant d\'avoir vu le produit.',
  error_generic: 'Une erreur est survenue. Reessayez.',
  error_phone_invalid: 'Ce numero de telephone n\'est pas correct.',
  error_code_invalid: 'Le code est incorrect.',
  error_code_expired: 'Le code a expire. Demandez un nouveau code.',
  error_offline: 'Pas de connexion internet.',
  error_audio_empty: 'Le message vocal est vide.',
  error_audio_format: 'Format audio non reconnu.',
  error_audio_too_long: 'Le message vocal est trop long.',
  error_audio_short: 'Enregistrement trop court. Parlez un peu plus longtemps.',
  error_mic_denied: 'Le micro est bloque. Autorisez le micro dans votre navigateur.',
  error_mic_missing: 'Aucun micro detecte sur cet appareil.',
  error_mic_busy: 'Le micro est utilise par une autre application.',
  error_gps_denied: 'Position refusee. Choisissez votre quartier.',
  error_gps_unavailable: 'Position indisponible. Choisissez votre quartier.',
  error_gps_timeout: 'Position introuvable. Choisissez votre quartier.',
  error_insecure_context: 'Le micro et la position exigent une page securisee (https ou localhost).',
  error_too_many_photos: 'Trop de photos.',
  error_file_type: 'Ce type de fichier n\'est pas accepte.',
  error_file_too_large: 'Fichier trop volumineux. Cinq megaoctets maximum.',
  error_file_empty: 'Le fichier est vide.',
  error_forbidden: 'Action interdite.',
  error_blocked_target: 'Vous avez bloque cet utilisateur.',
  error_banned: 'Votre compte est suspendu.',
  synced: 'Annonces synchronisees.',
};

export const PROMPT_KEYS = Object.keys(VOICE_PROMPTS);

export function isSupportedLanguage(code) {
  return LANGUAGES.some((l) => l.code === code);
}

export function languageMeta(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

/** Chemin public du fichier audio du message systeme. */
export function promptUrl(key, lang = DEFAULT_LANGUAGE) {
  const language = isSupportedLanguage(lang) ? lang : DEFAULT_LANGUAGE;
  return `/voice/${language}/${key}.opus`;
}

/** Texte francais de repli (synthese vocale / accessibilite / tests). */
export function promptText(key) {
  return VOICE_PROMPTS[key] || VOICE_PROMPTS.error_generic;
}

export function manifest() {
  return LANGUAGES.map((l) => ({
    language: l.code,
    baseUrl: `/voice/${l.code}/`,
    prompts: PROMPT_KEYS.map((k) => ({ key: k, file: `${k}.opus`, text: VOICE_PROMPTS[k] })),
  }));
}

export default { LANGUAGES, VOICE_PROMPTS, promptUrl, promptText, manifest, languageMeta };
