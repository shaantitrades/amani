import { badRequest } from '../lib/errors.js';

/**
 * Validation des entrees avec zod.
 * Les messages d'erreur sont traduits en "voiceKey" pour que le client puisse
 * jouer un message vocal comprehensible par un utilisateur non lecteur.
 */
export function validateBody(schema, options = {}) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return next(
        badRequest(options.code || 'validation_error', options.message || `Champ invalide : ${first.path.join('.')}`, {
          voiceKey: options.voiceKey || 'error_generic',
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        }),
      );
    }
    req.body = parsed.data;
    return next();
  };
}

export function validateQuery(schema, options = {}) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return next(
        badRequest(options.code || 'validation_error', options.message || 'Parametres de requete invalides', {
          voiceKey: options.voiceKey || 'error_generic',
        }),
      );
    }
    req.validatedQuery = parsed.data;
    return next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.params ?? {});
    if (!parsed.success) return next(badRequest('validation_error', 'Identifiant invalide'));
    req.params = parsed.data;
    return next();
  };
}

export default { validateBody, validateQuery, validateParams };
