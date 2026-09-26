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

/** L'utilisateur choisit "Plus tard" : on ne reaffiche pas avant le delai. */
export function markDismissed(storage = defaultStorage()) {
  return writeInstallState({ dismissedAt: Date.now() }, storage);
}

export default {
  INSTALL_KEY,
  INSTALL_COOLDOWN_DAYS,
  isStandalone,
  isIos,
  readInstallState,
  writeInstallState,
  shouldShowInstallPrompt,
  markInstalled,
  markDismissed,
};
