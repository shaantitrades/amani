/**
 * Detection d'installation de la PWA et logique d'affichage de l'invitation.
 *
 * Regle produit : l'invitation ne doit JAMAIS s'afficher a un utilisateur qui a
 * deja installe Bodogui (application ouverte en mode autonome), ni trop souvent
 * a celui qui l'a deja refusee.
 *
 * Toutes les fonctions sont pures (window/storage injectables) pour etre
 * testables sans navigateur.
 */

export const INSTALL_KEY = 'bodogui.install';
export const INSTALL_COOLDOWN_DAYS = 3;

/**
 * Installation obligatoire : sur le site, Bodogui s'installe et l'application
 * remplace le navigateur (plus de barre d'adresse, ouverture par l'icone,
 * notifications). Peut etre desactivee pour le developpement avec
 * `VITE_INSTALL_GATE=off` (fichier `.env` du frontend).
 */
export const INSTALL_GATE_ENABLED = import.meta.env?.VITE_INSTALL_GATE !== 'off';

/** Delai laisse au navigateur pour emettre `beforeinstallprompt`. */
export const INSTALL_GATE_GRACE_MS = 2500;

function defaultWindow() {
  return typeof window === 'undefined' ? null : window;
}

function defaultStorage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/** L'application tourne-t-elle en mode installe (autonome) ? */
export function isStandalone(win = defaultWindow()) {
  if (!win) return true; // hors navigateur (tests, rendu serveur) : rien a proposer
  try {
    if (win.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    if (win.matchMedia?.('(display-mode: minimal-ui)')?.matches) return true;
    if (win.matchMedia?.('(display-mode: fullscreen)')?.matches) return true;
    if (win.navigator?.standalone === true) return true; // iOS Safari
    const referrer = win.document?.referrer;
    if (typeof referrer === 'string' && referrer.startsWith('android-app://')) return true;
  } catch {
    /* acces refuse : on considere que ce n'est pas installe */
  }
  return false;
}

export function isIos(win = defaultWindow()) {
  const ua = win?.navigator?.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) && !win?.MSStream;
}

export function readInstallState(storage = defaultStorage()) {
  try {
    return JSON.parse(storage?.getItem(INSTALL_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function writeInstallState(patch, storage = defaultStorage()) {
  const next = { ...readInstallState(storage), ...patch };
  try {
    storage?.setItem(INSTALL_KEY, JSON.stringify(next));
  } catch {
    /* mode prive : la preference ne sera pas conservee */
  }
  return next;
}

/**
 * Faut-il afficher l'invitation d'installation ?
 * @param {object} input
 * @param {boolean} input.standalone l'app tourne en mode installe
 * @param {boolean} input.installed installation deja detectee (evenement appinstalled)
 * @param {number|null} input.dismissedAt horodatage du dernier refus
 * @param {boolean} input.canPrompt le navigateur propose un declencheur (beforeinstallprompt)
 * @param {boolean} input.ios navigateur iOS (installation manuelle, pas d'API)
 * @param {number} [input.now]
 * @param {number} [input.cooldownDays]
 * @param {boolean} [input.force]
 * @returns {{show: boolean, reason: string}}
 */
export function shouldShowInstallPrompt({
  standalone = false,
  installed = false,
  dismissedAt = null,
  canPrompt = false,
  ios = false,
  now = Date.now(),
  cooldownDays = INSTALL_COOLDOWN_DAYS,
  force = false,
} = {}) {
  if (standalone) return { show: false, reason: 'already_standalone' };
  if (installed) return { show: false, reason: 'already_installed' };
  if (force) return { show: true, reason: 'forced' };
  if (!canPrompt && !ios) return { show: false, reason: 'unsupported' };
  if (dismissedAt) {
    const elapsedDays = (now - Number(dismissedAt)) / 86400000;
    if (elapsedDays >= 0 && elapsedDays < cooldownDays) return { show: false, reason: 'snoozed' };
  }
  return { show: true, reason: ios && !canPrompt ? 'ios_manual_install' : 'prompt_available' };
}

/** Marque l'application comme installee (evenement appinstalled ou mode autonome). */
export function markInstalled(storage = defaultStorage()) {
  return writeInstallState({ installed: true, installedAt: Date.now() }, storage);
}

/**
 * Faut-il **bloquer** l'acces a l'application tant qu'elle n'est pas installee ?
 *
 * Regles :
 *  - l'application deja installee (mode autonome ou `appinstalled`) n'est jamais bloquee ;
 *  - si le navigateur sait installer (`beforeinstallprompt`), le blocage est total :
 *    seule l'installation ouvre l'application ;
 *  - sur iPhone (installation manuelle) et sur les navigateurs sans installation
 *    (Firefox, HTTP non securise), une porte de sortie apparait apres le delai
 *    d'attente — sinon ces visiteurs ne pourraient jamais utiliser le site.
 *
 * @param {object} input
 * @param {boolean} [input.enabled] installation obligatoire activee
 * @param {boolean} [input.standalone] l'app tourne en mode installe
 * @param {boolean} [input.installed] installation detectee lors d'une visite precedente
 * @param {boolean} [input.bypassed] le visiteur a choisi de continuer dans le navigateur
 * @param {boolean} [input.canPrompt] le navigateur a fourni un declencheur d'installation
 * @param {boolean} [input.ios] navigateur iOS (installation manuelle)
 * @param {boolean} [input.settled] le delai d'attente de `beforeinstallprompt` est ecoule
 * @param {boolean} [input.promptUsed] la boite de dialogue d'installation a deja ete ouverte
 * @returns {{block: boolean, canEscape: boolean, reason: string}}
 */
export function shouldShowInstallGate({
  enabled = INSTALL_GATE_ENABLED,
  standalone = false,
  installed = false,
  bypassed = false,
  canPrompt = false,
  ios = false,
  settled = false,
  promptUsed = false,
} = {}) {
  if (!enabled) return { block: false, canEscape: false, reason: 'disabled' };
  if (standalone) return { block: false, canEscape: false, reason: 'already_standalone' };
  if (installed) return { block: false, canEscape: false, reason: 'already_installed' };
  if (bypassed) return { block: false, canEscape: false, reason: 'bypassed' };
  if (canPrompt) return { block: true, canEscape: false, reason: 'prompt_available' };
  if (ios) return { block: true, canEscape: settled, reason: 'ios_manual_install' };
  // Navigateur sans boite de dialogue disponible : porte de sortie apres l'attente.
  // Si le declencheur a deja ete consomme (installation refusee), on reste bloque :
  // recharger la page repropose l'installation.
  if (promptUsed) return { block: true, canEscape: false, reason: 'prompt_refused' };
  return { block: true, canEscape: settled, reason: settled ? 'unsupported' : 'waiting_prompt' };
}

/** L'utilisateur choisit "Plus tard" : on ne reaffiche pas avant le delai. */
export function markDismissed(storage = defaultStorage()) {
  return writeInstallState({ dismissedAt: Date.now() }, storage);
}

/** Navigateur sans installation : le visiteur est autorise a continuer sans installer. */
export function markGateBypassed(storage = defaultStorage()) {
  return writeInstallState({ bypassed: true }, storage);
}

export default {
  INSTALL_KEY,
  INSTALL_COOLDOWN_DAYS,
  INSTALL_GATE_ENABLED,
  INSTALL_GATE_GRACE_MS,
  isStandalone,
  isIos,
  readInstallState,
  writeInstallState,
  shouldShowInstallPrompt,
  shouldShowInstallGate,
  markInstalled,
  markDismissed,
  markGateBypassed,
};
