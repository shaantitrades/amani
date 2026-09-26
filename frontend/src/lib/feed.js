/**
 * Requete du fil d'accueil.
 *
 * Le quartier du profil (choisi une fois dans "Mon compte", facultatif) sert de
 * repere, pas de filtre strict : on demande AUSSI les annonces sans quartier
 * (`include_unknown`). Sans cela, un profil avec quartier ne verrait presque rien,
 * car la majorite des vendeurs (bergers, zones rurales ou desertiques) publient
 * hors du referentiel des quartiers. Les filtres explicites de la recherche
 * (`Browse`) restent, eux, stricts.
 */

export const HOME_FEED_LIMIT = 8;

export function homeFeedQuery(user, limit = HOME_FEED_LIMIT) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (user?.district_id) {
    params.set('district_id', user.district_id);
    params.set('include_unknown', 'true');
  }
  return `/ads?${params.toString()}`;
}

export default { HOME_FEED_LIMIT, homeFeedQuery };
