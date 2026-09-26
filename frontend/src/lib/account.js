/**
 * Actions sensibles de « Mon compte ».
 *
 * Supprimer un compte est irreversible : le bouton n'est donc jamais visible
 * d'emblee. Il faut d'abord ouvrir la zone sensible (une ligne discrete en bas
 * de l'ecran), puis confirmer dans la feuille de confirmation — trois gestes
 * volontaires, impossibles a enchainer par accident en scrollant.
 * Logique pure, testable sans DOM.
 */

/** Etats possibles de la zone sensible. */
export const DANGER_HIDDEN = 'hidden';
export const DANGER_REVEALED = 'revealed';

/** Etat suivant : un appui ouvre la zone sensible, un autre la referme. */
export function toggleDanger(state = DANGER_HIDDEN) {
  return state === DANGER_REVEALED ? DANGER_HIDDEN : DANGER_REVEALED;
}

/** Le bouton de suppression n'existe dans la page que si la zone est ouverte. */
export function isDangerOpen(state) {
  return state === DANGER_REVEALED;
}

/**
 * Changement de langue.
 *
 * Basculer la langue change tout l'ecran : on demande donc d'abord confirmation
 * DANS LA LANGUE ACTUELLE (celle que la personne comprend, sinon elle se
 * retrouve avec un ecran qu'elle ne lit pas). Renvoie la langue a confirmer, ou
 * `null` quand il n'y a rien a demander (meme langue deja active, choix vide).
 */
export function languageChangeRequest(current, next) {
  if (!next || next === current) return null;
  return next;
}

/**
 * Message de confirmation : le libelle traduit contient `{language}`, complete
 * par le nom natif de la langue visee (ex. « عربي », « Fulfulde »). Jamais deux
 * espaces d'affilee, jamais de `{language}` qui reste a l'ecran.
 */
export function languageConfirmMessage(text, native) {
  return String(text ?? '')
    .replace('{language}', native ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default {
  DANGER_HIDDEN,
  DANGER_REVEALED,
  toggleDanger,
  isDangerOpen,
  languageChangeRequest,
  languageConfirmMessage,
};
