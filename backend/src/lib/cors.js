/**
 * Politique d'origine de l'API (middleware CORS).
 *
 * Le site est servi par le meme Nginx que `/api` : les appels du navigateur sont
 * donc same-origin, et CORS n'est pas la barriere de securite (les jetons
 * voyagent dans l'en-tete `Authorization`, jamais dans un cookie).
 *
 * Une liste vide (`CORS_ORIGINS` non definie) ne doit donc jamais bloquer le
 * site lui-meme : c'est le piege qui fait echouer toutes les connexions apres
 * un deploiement, avec un message d'erreur incomprehensible cote utilisateur.
 */

/**
 * @param {string|undefined} origin Origine envoyee par le navigateur
 * @param {string[]|undefined} allowed Liste configuree via `CORS_ORIGINS`
 * @returns {boolean} true si la requete peut continuer
 */
export function isOriginAllowed(origin, allowed) {
  // Applications mobiles, curl, tests, webhooks : aucun en-tete Origin.
  if (!origin) return true;
  // CORS_ORIGINS non configure : on ne bloque pas (un avertissement est
  // journalise au demarrage pour rappeler de definir la liste).
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  // `*` = toutes les origines, sinon correspondance exacte.
  return allowed.includes('*') || allowed.includes(origin);
}
