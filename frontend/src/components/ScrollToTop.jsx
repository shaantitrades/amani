import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { scrollPageToTop, shouldResetScroll } from '../lib/scroll.js';

/**
 * Remet la page en haut a chaque changement d'ecran (et au premier affichage).
 *
 * Sans cela, l'ecran suivant herite de la position de defilement du precedent :
 * les premiers elements (onglets du groupe, tuile VENDRE de l'accueil) restent
 * partiellement caches sous la barre du haut, qui est collante.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const previousPath = useRef(null);

  useEffect(() => {
    if (shouldResetScroll(previousPath.current, pathname)) scrollPageToTop();
    previousPath.current = pathname;
  }, [pathname]);

  return null;
}

export default ScrollToTop;
