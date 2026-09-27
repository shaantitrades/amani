import { startDiagnosticServer } from './lib/diagnostic-server.js';
import { hintFor } from './lib/startup-hint.js';

/**
 * Point d'entree du conteneur `api` (voir backend/Dockerfile).
 *
 * Les imports sont DYNAMIQUES a dessein : si `config/env.js` refuse la
 * configuration (il leve desormais une erreur au lieu de sortir en silence),
 * on demarre un serveur de diagnostic qui expose la cause en JSON sur
 * `/api/v1/healthz`. Sans cela le conteneur mourait et Nginx repondait 502
 * partout : panne indebogable depuis le site.
 *
 * `STRICT_STARTUP=1` restaure l'ancien comportement (sortie en erreur, pour un
 * orchestrateur qui surveille le code de sortie).
 */
const PORT = Number(process.env.PORT || 4000);

try {
  const { startServer } = await import('./server.js');
  await startServer();
} catch (err) {
  const hint = hintFor(err);
  // eslint-disable-next-line no-console
  console.error(`[bodogui] Demarrage refuse : ${err?.message || err}`);
  if (process.env.STRICT_STARTUP === '1') {
    // eslint-disable-next-line no-console
    console.error(`[bodogui] STRICT_STARTUP=1 : arret du conteneur.\n${hint}`);
    process.exit(1);
  }
  startDiagnosticServer({ port: PORT, error: err?.message || String(err), hint });
}
