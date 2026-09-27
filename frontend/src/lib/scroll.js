/**
 * Defilement de la page : remise en haut a chaque changement d'ecran.
 *
 * Probleme resolu : la barre du haut est collante (`position: sticky`). Quand on
 * arrive sur un ecran deja defile (position de defilement conservee par le
 * navigateur, ou page devenue plus haute que la fenetre apres l'ouverture du
 * clavier), le premier bloc de l'ecran — les onglets du groupe, la tuile VENDRE
 * de l'accueil — se retrouve a moitie cache DERRIERE cette barre. On repart donc
 * toujours du haut, et l'application reprend la main sur la restauration
 * automatique du navigateur.
 *
 * La logique est separee du DOM pour rester testable sans navigateur.
 */

import { normalizePath } from './nav.js';

/** Faut-il remonter en haut ? `previousPath` = ecran quitte (null au demarrage). */
export function shouldResetScroll(previousPath, nextPath) {
  const next = normalizePath(nextPath);
  const previous = previousPath ? normalizePath(previousPath) : null;
  return previous !== next;
}

/** Fenetre du navigateur, ou null hors navigateur (tests, rendu serveur). */
function defaultScope() {
  return typeof window === 'undefined' ? null : window;
}

/**
 * Remonte la page en haut. `scope` sert aux tests ; par defaut la fenetre.
 * Renvoie true quand le defilement a pu etre pilote.
 */
export function scrollPageToTop(scope = defaultScope()) {
  if (!scope || typeof scope.scrollTo !== 'function') return false;
  scope.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  return true;
}

/**
 * Empeche le navigateur de restaurer tout seul l'ancienne position quand
 * l'application installee est rouverte ou la page rechargee : c'est
 * l'application qui decide de repartir du haut.
 */
export function disableScrollRestoration(scope = defaultScope()) {
  if (!scope || !scope.history) return false;
  try {
    scope.history.scrollRestoration = 'manual';
    return scope.history.scrollRestoration === 'manual';
  } catch {
    // Safari en navigation privee : la propriete est en lecture seule.
    return false;
  }
}

export default { shouldResetScroll, scrollPageToTop, disableScrollRestoration };
