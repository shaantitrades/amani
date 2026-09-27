import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import env from './config/env.js';
import logger from './lib/logger.js';
import { isOriginAllowed } from './lib/cors.js';
import apiRoutes from './routes/index.js';
import healthRoutes from './routes/health.js';
import mediaProxyRoutes from './routes/media-proxy.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { limiters } from './middleware/rateLimit.js';

/**
 * Application Express Bodogui.
 * Contraintes : connexions lentes, clients peu puissants, donc :
 *  - reponses JSON compactes, pas de HTML
 *  - cache HTTP explicite (le reseau est le facteur limitant)
 *  - compression assuree par Nginx en amont
 */
export function createApp() {
  const app = express();

  // Derriere Traefik/Coolify : necessaire pour req.ip et le rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // les medias sont servis par Cloudflare/Nginx
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Voir lib/cors.js : liste vide = CORS non configure, on ne bloque pas.
        if (isOriginAllowed(origin, env.corsOrigins)) return callback(null, true);
        return callback(new Error(`Origine non autorisee : ${origin}`));
      },
      credentials: true,
      maxAge: 86400,
    }),
  );

  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: false, limit: '512kb' }));

  if (!env.isTest) {
    app.use(
      pinoHttp({
        logger,
        // Journal compact : les en-tetes complets saturent les logs (et le disque
        // du VPS) pour aucune information utile en production.
        serializers: {
          req(req) {
            return { method: req.method, url: req.url, ip: req.remoteAddress };
          },
          res(res) {
            return { status: res.statusCode };
          },
        },
        customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
        autoLogging: {
          ignore: (req) => req.url === '/healthz' || req.url?.startsWith('/media/'),
        },
      }),
    );
  }

  app.use(limiters.global());

  // Sonde de sante disponible a la racine (Coolify / Docker healthcheck)
  app.use('/', healthRoutes);
  // Proxy public des medias : GET /media/<cle> (mis en cache par Cloudflare)
  app.use('/', mediaProxyRoutes);
  app.use('/api/v1', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
