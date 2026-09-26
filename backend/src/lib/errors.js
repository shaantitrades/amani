/** Erreur applicative : porte un code HTTP, un code machine et une cle vocale. */
export class AppError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    // Cle du message vocal joue par le client (ex: "error_phone_invalid")
    this.voiceKey = options.voiceKey || code;
    this.details = options.details;
    this.expose = options.expose !== false;
  }
}

export const badRequest = (code, message, options) => new AppError(400, code, message, options);
export const unauthorized = (code = 'unauthorized', message = 'Authentification requise', options) =>
  new AppError(401, code, message, options);
export const forbidden = (code = 'forbidden', message = 'Action interdite', options) =>
  new AppError(403, code, message, options);
export const notFound = (code = 'not_found', message = 'Ressource introuvable', options) =>
  new AppError(404, code, message, options);
export const conflict = (code = 'conflict', message = 'Conflit de donnees', options) =>
  new AppError(409, code, message, options);
export const tooMany = (code = 'too_many_requests', message = 'Trop de tentatives', options) =>
  new AppError(429, code, message, options);

/** Enveloppe un handler async pour propager les erreurs vers le middleware d'erreur. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** Enveloppe les erreurs PostgreSQL en erreurs applicatives lisibles. */
export function mapPgError(err) {
  if (err && err.code === '23505' || err?.code === '23505') {
    return new AppError(409, 'duplicate', 'Cet element existe deja');
  }
  if (err?.code === '23503') {
    return new AppError(400, 'invalid_reference', 'Reference invalide');
  }
  if (err?.code === '23514') {
    return new AppError(400, 'check_violation', 'Valeur refusee par la base de donnees');
  }
  return err instanceof AppError ? err : new AppError(500, 'internal_error', 'Erreur interne');
}
