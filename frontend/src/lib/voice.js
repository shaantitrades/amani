import { promptUrl, promptText, languageMeta } from '../i18n/index.js';
import { playAudioUrl, stopAudio } from './audio.js';

/**
 * Retour vocal du systeme.
 *
 * Etat actuel : les messages vocaux natifs ne sont pas encore enregistres
 * (voir docs/VOICE_PROMPTS.md). La synthese vocale du navigateur (TTS) est donc
 * DESACTIVEE pour le moment, et le retour vocal est desactive par defaut :
 * l'application reste silencieuse, l'utilisateur peut l'activer avec le bouton 🔊.
 *
 * Chaine de repli, dans l'ordre :
 *   1. fichier Opus enregistre par un natif -> /voice/<langue>/<cle>.opus
 *   2. synthese vocale du navigateur (uniquement si SPEECH_SYNTHESIS_ENABLED)
 *   3. bip court, uniquement si explicitement demande (options.fallbackBeep)
 *
 * Pour reactiver la voix : enregistrer les fichiers Opus (rien a changer cote
 * code) et/ou passer SPEECH_SYNTHESIS_ENABLED a true.
 */

const SPEECH_SYNTHESIS_ENABLED = false;
const TTS_KEY = 'bodogui.voice.tts';

const availability = new Map(); // cle -> true (fichier present) / false (absent)
let audioContext = null;
let enabled = false; // retour vocal coupe par defaut (CHOICE explicite de l'utilisateur)
// Preference persistee : par defaut la synthese vocale reste desactivee tant que
// les messages vocaux natifs ne sont pas enregistres.
let speechEnabled = (() => {
  try {
    const stored = localStorage.getItem(TTS_KEY);
    return stored === null ? SPEECH_SYNTHESIS_ENABLED : stored === '1';
  } catch {
    return SPEECH_SYNTHESIS_ENABLED;
  }
})();
let currentLanguage = 'fr';

export function setVoiceLanguage(lang) {
  currentLanguage = lang || 'fr';
}

export function setVoiceEnabled(value) {
  enabled = Boolean(value);
  if (!enabled) stopAudio();
}

export function isVoiceEnabled() {
  return enabled;
}

/** Active/desactive la synthese vocale (desactivee tant que les voix manquent). */
export function setSpeechEnabled(value) {
  speechEnabled = value === undefined ? SPEECH_SYNTHESIS_ENABLED : Boolean(value);
  try {
    localStorage.setItem(TTS_KEY, speechEnabled ? '1' : '0');
  } catch {
    /* stockage indisponible : on garde la valeur en memoire */
  }
}

export function isSpeechEnabled() {
  return speechEnabled;
}

/** Vrai si une voix enregistree par un natif existe pour cette cle. */
export async function promptExists(key) {
  const info = await promptFileAvailable(key);
  return Boolean(info?.ok);
}

/** Bip de secours (0,25 s) : joue uniquement si demande explicitement. */
function beep(frequency = 880) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioContext = audioContext || new Ctx();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.25);
  } catch {
    /* le son est un confort : ne jamais casser l'application */
  }
}

/** Verifie une seule fois par session si le fichier vocal existe. */
async function promptFileAvailable(key) {
  const url = promptUrl(key, currentLanguage);
  if (availability.has(url)) return availability.get(url);
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') || '';
    const ok = res.ok && (type.includes('audio') || type.includes('octet-stream'));
    availability.set(url, { ok, url });
  } catch {
    availability.set(url, { ok: false, url });
  }
  return availability.get(url);
}

function speakWithSynthesis(key) {
  return new Promise((resolve) => {
    if (!speechEnabled || typeof speechSynthesis === 'undefined') return resolve(false);
    try {
      const utterance = new SpeechSynthesisUtterance(promptText(key));
      utterance.lang = languageMeta(currentLanguage).tts;
      utterance.rate = 0.95;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      speechSynthesis.speak(utterance);
      return undefined;
    } catch {
      return resolve(false);
    }
  });
}

/**
 * Joue le message vocal correspondant a une action.
 * @param {string} key cle de message (ex: 'ad_published')
 * @param {{fallbackBeep?: boolean}} [options] `fallbackBeep: true` pour un bip
 *        quand aucun fichier n'existe (silencieux par defaut).
 */
export async function announce(key, options = {}) {
  if (!enabled || !key) return { played: false, reason: 'disabled' };

  const file = await promptFileAvailable(key);
  if (file?.ok) {
    try {
      await playAudioUrl(file.url);
      return { played: true, source: 'file' };
    } catch {
      /* on continue avec la synthese */
    }
  }

  const spoke = await speakWithSynthesis(key);
  if (spoke) return { played: true, source: 'tts' };

  if (options.fallbackBeep === true) {
    beep(key.startsWith('error') ? 320 : 880);
    return { played: true, source: 'beep' };
  }
  return { played: false, source: 'none' };
}

/** Annonce un message d'erreur (voiceKey renvoye par l'API). */
export function announceError(voiceKey) {
  return announce(voiceKey || 'error_generic');
}

/**
 * Lit un montant a voix haute.
 * Depend de la synthese vocale : renvoie `played: false` si elle est desactivee
 * (l'interface masque alors le bouton 🔊 du clavier).
 */
export async function speakNumber(amount, currency = 'XAF') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return { played: false };
  if (!speechEnabled || typeof speechSynthesis === 'undefined') return { played: false, reason: 'tts_disabled' };
  try {
    const unit = currency === 'XAF' ? 'francs' : currency === 'USD' ? 'dollars' : currency;
    const utterance = new SpeechSynthesisUtterance(`${value} ${unit}`);
    utterance.lang = languageMeta(currentLanguage).tts;
    speechSynthesis.speak(utterance);
    return { played: true, source: 'tts' };
  } catch {
    return { played: false };
  }
}

export default {
  announce,
  announceError,
  speakNumber,
  setVoiceLanguage,
  setVoiceEnabled,
  isVoiceEnabled,
  setSpeechEnabled,
  isSpeechEnabled,
  promptExists,
};

