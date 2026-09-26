import { AppError } from '../lib/errors.js';
import logger from '../lib/logger.js';
import env from '../config/env.js';

/** 404 JSON pour les routes inconnues. */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: `Route inconnue : ${req.method} ${req.path}`, voiceKey: 'error_generic' },
  });
}

/**
 * Gestionnaire d'erreurs central. Reponse toujours exploitable par le client :
 * { error: { code, message, voiceKey, details? } }
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const isApp = err instanceof AppError;
  const status = isApp ? err.status : err?.status || 500;

  if (status >= 500) {
    logger.error({ err: err.message, stack: env.isProd ? undefined : err.stack, path: req.path }, 'Erreur serveur');
  } else {
    logger.warn({ code: err?.code, path: req.path }, 'Erreur client');
  }

  const body = {
    error: {
      code: isApp ? err.code : 'internal_error',
      message: isApp && err.expose ? err.message : status >= 500 ? 'Erreur interne du serveur' : err.message,
      voiceKey: isApp ? err.voiceKey : 'error_generic',
    },
  };
  if (isApp && err.details) body.error.details = err.details;

  res.status(status).json(body);
}

export default { notFoundHandler, errorHandler };
