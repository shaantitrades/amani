/**
 * Etat du demarrage (migrations), expose par la sonde `/healthz`.
 *
 * Volontairement sans dependance : `routes/health.js` doit pouvoir afficher la
 * cause d'un demarrage degrade sans risquer un import circulaire.
 */

/** @type {{migrations: 'pending'|'ok'|'failed', applied: number, error: string|null, hint: string|null, at: string|null}} */
let state = { migrations: 'pending', applied: 0, error: null, hint: null, at: null };

/** Migrations appliquees avec succes. */
export function setMigrationsReady(applied = 0) {
  state = { migrations: 'ok', applied, error: null, hint: null, at: new Date().toISOString() };
}

/**
 * Migrations impossibles : l'API peut demarrer en mode degrade (voir
 * `src/start.js` et `STRICT_STARTUP`), mais la cause doit rester visible.
 */
export function setMigrationFailure(err, hint = null) {
  state = {
    migrations: 'failed',
    applied: 0,
    error: String(err?.message || err || 'cause inconnue'),
    hint: hint || null,
    at: new Date().toISOString(),
  };
}

/** Copie de l'etat courant (jamais la reference interne). */
export function startupState() {
  return { ...state };
}

export default { setMigrationsReady, setMigrationFailure, startupState };
