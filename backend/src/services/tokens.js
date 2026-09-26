import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { query, one } from '../lib/db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { AppError, unauthorized } from '../lib/errors.js';

/** Jeton d'acces JWT (30 jours par defaut : les utilisateurs ne doivent pas se reconnecter souvent). */
export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      phone: user.phone,
      adm: Boolean(user.is_admin),
      ver: Number(user.token_version || 1),
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_TTL, issuer: 'bodogui' },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { issuer: 'bodogui' });
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid', 'Session expiree');
  }
}

/** Cree un jeton de rafraichissement opaque (stocke hache). */
export async function issueRefreshToken(userId, userAgent = null, db = { query }) {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 3600 * 1000);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, sha256(token), userAgent?.slice(0, 250) || null, expiresAt],
  );
  return { token, expiresAt };
}

export async function issueSession(user, userAgent) {
  const accessToken = signAccessToken(user);
  const refresh = await issueRefreshToken(user.id, userAgent);
  return {
    accessToken,
    refreshToken: refresh.token,
    accessTokenExpiresIn: env.JWT_TTL,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

/** Rotation du jeton de rafraichissement (usage unique). */
export async function rotateRefreshToken(oldToken, userAgent) {
  const row = await one(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(oldToken)],
  );
  if (!row) throw unauthorized('refresh_invalid', 'Session expiree, reconnectez-vous');
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
  const user = await one('SELECT * FROM users WHERE id = $1', [row.user_id]);
  if (!user) throw unauthorized('user_missing', 'Compte introuvable');
  if (user.banned_at && (!user.ban_expires_at || new Date(user.ban_expires_at) > new Date())) {
    throw new AppError(403, 'banned', 'Compte suspendu', { voiceKey: 'account_banned' });
  }
  const accessToken = signAccessToken(user);
  const refresh = await issueRefreshToken(user.id, userAgent);
  return { accessToken, refreshToken: refresh.token, user };
}

export async function revokeAllTokens(userId) {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

export default { signAccessToken, verifyAccessToken, issueSession, rotateRefreshToken, revokeAllTokens };
