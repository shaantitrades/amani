/**
 * Aides lisibles pour les echecs de demarrage de l'API.
 *
 * Ce module n'importe RIEN (ni configuration, ni base, ni logger) : il doit
 * rester utilisable quand la configuration elle-meme est refusee, c'est-a-dire
 * quand `config/env.js` leve une erreur des l'import.
 */

/**
 * Aide pour les echecs de connexion PostgreSQL les plus frequents au demarrage.
 * Sans elle, le conteneur `api` sort en laissant un 502 opaque cote Nginx.
 * @param {unknown} err
 * @returns {string|null}
 */
export function startupHint(err) {
  const message = String(err?.message || err || '');
  if (/password authentication failed|SASL|client password must be a string|no password supplied/i.test(message)) {
    return "Postgres refuse le mot de passe. Il doit etre identique a celui utilise lors de la creation du volume db-data : soit remettre l'ancien POSTGRES_PASSWORD, soit supprimer le volume db-data (donnees de recette) puis redeployer.";
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return "Hote PostgreSQL introuvable : DATABASE_URL est mal formee. Si le mot de passe contient +, /, = ou @ l'URL est coupee avant l'hote (typique d'openssl rand -base64) : n'utilisez que les variables PG* (voir docker-compose.yml) ou un mot de passe hexadecimal (openssl rand -hex 24).";
  }
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return 'Postgres est injoignable : verifier que le service db est demarre et que la connexion vise db:5432.';
  }
  if (/invalid url|URI malformed|percent-encoding|URIError/i.test(message)) {
    return "DATABASE_URL est invalide : le mot de passe contient probablement +, /, = ou @ (typique d'openssl rand -base64). Utiliser un mot de passe hexadecimal : openssl rand -hex 24, ou les variables PG* du compose (mot de passe encode automatiquement).";
  }
  if (/JWT_SECRET/i.test(message)) {
    return 'JWT_SECRET doit faire au moins 16 caracteres : regenerer avec openssl rand -hex 32.';
  }
  return null;
}

/**
 * Aide pour une configuration invalide (issues zod de `config/env.js`).
 * @param {{path?: unknown[], message?: string}[]} issues
 * @returns {string}
 */
export function configHint(issues = []) {
  const lines = [
    ...new Set(
      (Array.isArray(issues) ? issues : []).map(
        (issue) => `${(issue?.path || []).join('.') || 'variable'}: ${issue?.message || 'valeur invalide'}`,
      ),
    ),
  ];
  return [
    'Configuration invalide : corriger les variables listees ci-dessous puis redeployer.',
    ...lines.map((line) => `  - ${line}`),
    'Valeurs attendues : voir docs/ENVIRONMENT.md.',
  ].join('\n');
}

/** Aide generique quand aucune cause connue n'est reconnue. */
export const GENERIC_HINT =
  "Erreur inattendue au demarrage. Verifier DATABASE_URL, JWT_SECRET et POSTGRES_PASSWORD " +
  '(documents : docs/ENVIRONMENT.md), que les services db et redis sont demarres, ' +
  'puis consulter les logs du service api (Coolify > api > Logs).';

/**
 * Meilleure aide disponible pour une erreur de demarrage.
 * @param {unknown} err
 * @returns {string}
 */
export function hintFor(err) {
  if (err && Array.isArray(err.configIssues) && err.configIssues.length > 0) {
    return configHint(err.configIssues);
  }
  return startupHint(err) || GENERIC_HINT;
}

export default { startupHint, configHint, hintFor, GENERIC_HINT };
