import { one } from '../lib/db.js';
import { verifyAccessToken } from '../services/tokens.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { getBlockedIds } from '../services/blocks.js';

/**
 * Authentification par JWT (obtenu apres verification du numero par SMS).
 * Aucun mot de passe : le telephone est l'identifiant unique.
 */

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (req.query?.token) return String(req.query.token);
  return null;
}

async function loadUser(token) {
  const payload = verifyAccessToken(token);
  const user = await one('SELECT * FROM users WHERE id = $1', [payload.sub]);
  if (!user) throw unauthorized('user_not_found', 'Compte introuvable');
  return user;
}

/** Verifie que le compte n'est pas suspendu (temporairement ou definitivement). */
export function assertNotBanned(user) {
  if (!user.banned_at) return;
  const expired = user.ban_expires_at && new Date(user.ban_expires_at) <= new Date();
  if (expired) return;
  throw forbidden('banned', 'Compte suspendu', {
    voiceKey: 'account_banned',
    details: { reason: user.ban_reason, expiresAt: user.ban_expires_at },
  });
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw unauthorized('missing_token', 'Connectez-vous pour continuer');
    const user = await loadUser(token);
    assertNotBanned(user);
    req.user = user;
    req.blockedIds = await getBlockedIds(user.id);
    next();
  } catch (err) {
    next(err);
  }
}

/** Pour les endpoints publics qui personnalisent la reponse si connecte. */
export async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const user = await loadUser(token);
    if (user.banned_at && !(user.ban_expires_at && new Date(user.ban_expires_at) <= new Date())) {
      return next();
    }
    req.user = user;
    req.blockedIds = await getBlockedIds(user.id);
    return next();
  } catch {
    return next();
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return next(forbidden('admin_only', 'Reserve aux administrateurs', { voiceKey: 'error_forbidden' }));
  }
  return next();
}

export default { requireAuth, optionalAuth, requireAdmin, assertNotBanned };
