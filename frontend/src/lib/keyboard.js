/**
 * Defilement quand le clavier du telephone s'ouvre.
 *
 * Pourquoi ne pas utiliser `scrollIntoView({ block: 'center' })` ?
 *  - les navigateurs anciens (Android 5) ignorent l'objet d'options et ramenent
 *    le haut de l'element tout en haut de la fenetre, donc SOUS la barre du haut
 *    (`position: sticky`) : le champ reste cache pendant toute la saisie ;
 *  - le centrage descend trop quand le navigateur compte encore la zone du
 *    clavier comme visible.
 * On calcule donc le strict minimum de pixels a defiler, en garantissant que le
 * champ ne passe jamais sous la barre du haut.
 */

/** Marge gardee entre le champ/le bouton et les bords de la zone visible. */
export const KEYBOARD_MARGIN = 8;

/**
 * Zone reellement visible (au-dessus du clavier), en coordonnees fenetre.
 * `visualViewport` suit le clavier ; `innerHeight` sert de repli aux navigateurs
 * qui ne l'ont pas (Android 5) : on ne defile alors jamais a tort.
 * @param {Window|{visualViewport?: object, innerHeight?: number}} [win]
 * @returns {{top: number, bottom: number}}
 */
export function visibleViewport(win) {
  const w = win || (typeof window === 'undefined' ? null : window);
  const vv = w && w.visualViewport;
  if (vv && vv.height) {
    const top = vv.offsetTop || 0;
    return { top, bottom: top + vv.height };
  }
  return { top: 0, bottom: (w && w.innerHeight) || 0 };
}

/**
 * Pixels a ajouter au defilement courant (`window.scrollBy(0, delta)` : positif
 * = on descend) pour que le champ reste lisible et l'action atteignable.
 *
 * Deux regles, dans cet ordre :
 *  1. le champ ne passe JAMAIS sous la barre du haut ;
 *  2. on descend juste ce qu'il faut pour amener le bas de l'action au-dessus du
 *     clavier, et pas plus que la place disponible avant de cacher le champ.
 *
 * @param {{field?: {top: number, bottom: number}|null,
 *          action?: {top: number, bottom: number}|null,
 *          safeTop?: number, visibleBottom?: number}} [rects]
 * @returns {number} pixels a ajouter au defilement (peut etre negatif)
 */
export function keyboardScrollDelta({ field, action, safeTop = 0, visibleBottom = 0 } = {}) {
  if (!field || !visibleBottom) return 0;
  const minTop = safeTop + KEYBOARD_MARGIN;
  const targetBottom = (action || field).bottom;
  let delta = 0;
  if (targetBottom > visibleBottom - KEYBOARD_MARGIN) {
    delta = targetBottom + KEYBOARD_MARGIN - visibleBottom;
    // Jamais au point de faire passer le champ sous la barre du haut.
    delta = Math.min(delta, Math.max(0, field.top - minTop));
  }
  if (field.top - delta < minTop) delta = field.top - minTop;
  return Math.round(delta);
}

/**
 * Applique le calcul a des elements reels.
 * `window.scrollBy(0, delta)` est appele avec des NOMBRES (et non un objet
 * d'options) pour rester compatible avec les anciens navigateurs.
 *
 * @param {{field?: object|null, action?: object|null, bar?: object|null,
 *          doc?: Document, win?: Window}} [opts]
 *   `bar` est la barre du haut collante ; a defaut elle est retrouvee dans le DOM.
 * @returns {number} pixels demandes (0 si rien a faire)
 */
export function keepFieldVisible({ field, action, bar, doc, win } = {}) {
  const w = win || (typeof window === 'undefined' ? null : window);
  const rect = (el) => (el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null);
  if (!w || !rect(field)) return 0;
  const d = doc || w.document;
  const topbar = bar || (d && typeof d.querySelector === 'function' ? d.querySelector('.topbar') : null);
  const delta = keyboardScrollDelta({
    field: rect(field),
    action: rect(action),
    safeTop: (rect(topbar) || {}).bottom || 0,
    visibleBottom: visibleViewport(w).bottom,
  });
  if (delta && typeof w.scrollBy === 'function') w.scrollBy(0, delta);
  return delta;
}

export default { keyboardScrollDelta, keepFieldVisible, visibleViewport, KEYBOARD_MARGIN };
