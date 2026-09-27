import http from 'node:http';

/**
 * Serveur HTTP de secours : repond a TOUTES les requetes (503 + JSON) avec la
 * cause du demarrage impossible, au lieu de laisser le conteneur `api` mourir.
 *
 * Pourquoi : quand le conteneur sort, Nginx renvoie `502 Bad Gateway` sur tout
 * `/api/v1/...` et le site affiche une erreur generique : impossible de savoir
 * ce qui s'est passe sans acceder aux logs Coolify. Ce serveur rend la cause
 * lisible depuis un simple navigateur : `<domaine>/api/v1/healthz`.
 *
 * Aucune dependance et aucune lecture de la configuration : il doit fonctionner
 * meme si `config/env.js` a refuse de se charger.
 */
export function startDiagnosticServer({ port, error, hint, log = console, docs = 'docs/ENVIRONMENT.md' }) {
  const build = () =>
    JSON.stringify(
      {
        status: 'startup_failed',
        service: 'bodogui-api',
        error: String(error ?? 'cause inconnue'),
        hint: hint || null,
        docs,
        at: new Date().toISOString(),
      },
      null,
      2,
    );

  const server = http.createServer((req, res) => {
    const body = build();
    res.writeHead(503, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  });

  server.on('error', (err) => {
    log.error(`[bodogui] Serveur de diagnostic indisponible : ${err.message}`);
  });

  server.listen(port, () => {
    log.error(
      [
        '[bodogui] ==============================================================',
        "[bodogui] DEMARRAGE IMPOSSIBLE : l'API n'a pas pu se lancer.",
        `[bodogui] Cause   : ${String(error ?? 'cause inconnue')}`,
        `[bodogui] Conseil : ${hint || 'voir les logs ci-dessus'}`,
        `[bodogui] Un serveur de DIAGNOSTIC ecoute sur le port ${port} :`,
        '[bodogui] ouvrir <votre-domaine>/api/v1/healthz dans un navigateur',
        '[bodogui] pour lire ce message en JSON (cette reponse reste en 503).',
        '[bodogui] ==============================================================',
      ].join('\n'),
    );
  });

  return server;
}

export default startDiagnosticServer;
