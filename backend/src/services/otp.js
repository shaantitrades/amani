import env from '../config/env.js';
import { one, query } from '../lib/db.js';
import { generateOtp, hashOtp, verifyOtp } from '../lib/crypto.js';
import { normalizePhone } from '../lib/phone.js';
import { getCache, keys } from '../lib/cache.js';
import { AppError, badRequest, tooMany } from '../lib/errors.js';
import { sendSms, renderTemplate } from './sms.js';
import logger from '../lib/logger.js';

/**
 * Inscription / connexion par numero de telephone + code SMS.
 * Aucun email, aucun mot de passe, aucune piece d'identite.
 */

/** Code fixe de recette : 4 a 8 chiffres (meme regle que `config/env.js`). */
const TEST_LOGIN_CODE_PATTERN = /^\d{4,8}$/;

async function enforceRateLimit(cacheKey, max, windowSeconds) {
  const cache = getCache();
  let count;
  try {
    count = await cache.incr(cacheKey, windowSeconds);
  } catch {
    return; // pas de cache : on ne bloque pas l'utilisateur legitime
  }
  if (count > max) throw tooMany('otp_rate_limited', 'Trop de demandes de code. Reessayez dans une heure.', {
    voiceKey: 'error_code_rate_limited',
  });
}

/**
 * Code a envoyer pour ce numero :
 *  - numero de test (`TEST_LOGIN_PHONES`) : code fixe (`TEST_LOGIN_CODE`), aucun SMS ;
 *  - sinon : code aleatoire a 5 chiffres.
 * Un code de test mal forme (moins de 4 chiffres, lettres...) est ignore : on ne
 * cree jamais de code trivial a cause d'une faute de frappe dans la configuration.
 * Fonction pure (aucune base de donnees) pour rester testable.
 * @param {string} phone numero saisi ou E.164
 * @param {{testPhones?: string[], testCode?: string}} [opts]
 * @returns {{code: string, simulated: boolean, phone: string}}
 */
export function resolveOtpCode(phone, { testPhones = env.testLoginPhones, testCode = env.testLoginCode } = {}) {
  const normalized = normalizePhone(phone);
  const e164 = normalized.ok ? normalized.e164 : phone;
  const codeIsValid = TEST_LOGIN_CODE_PATTERN.test(testCode || '');
  if (codeIsValid && testPhones.length && normalized.ok && testPhones.includes(e164)) {
    return { code: testCode, simulated: true, phone: e164 };
  }
  return { code: generateOtp(5), simulated: false, phone: e164 };
}

export async function requestOtp({ phone, ip, language = 'fr', purpose = 'login' }) {
  await enforceRateLimit(keys.otpRatePhone(phone), env.OTP_PER_PHONE_PER_HOUR, 3600);
  if (ip) await enforceRateLimit(keys.otpRateIp(ip), env.OTP_PER_IP_PER_HOUR, 3600);

  const { code, simulated } = resolveOtpCode(phone);
  const ttl = env.OTP_TTL_SECONDS;
  await query(
    `INSERT INTO otp_codes (phone, code_hash, purpose, max_attempts, expires_at, request_ip)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval, $6)`,
    [phone, hashOtp(code, phone), purpose, env.OTP_MAX_ATTEMPTS, String(ttl), ip || null],
  );

  let sms = { ok: false, provider: env.SMS_PROVIDER };
  if (simulated) {
    // Numero de recette : le code est connu de l'administrateur, on ne consomme
    // pas de credit SMS. Le code reste a usage unique et expire comme les autres.
    logger.warn({ phone, provider: 'test' }, 'Numero de test : code fixe, aucun SMS envoye');
    sms = { ok: true, provider: 'test', simulated: true };
  } else {
    const minutes = Math.max(1, Math.round(ttl / 60));
    const body = renderTemplate('otp', language, { code }).replace('{{ttl}}', String(minutes));
    try {
      // `code` n'est utilise que par WhatsApp (modele valide) : les autres
      // passerelles envoient `body`.
      sms = await sendSms({ to: phone, body, code });
    } catch (err) {
      logger.error({ err: err.message, phone }, "Echec d'envoi du SMS OTP");
      // En production, on ne bloque pas la reponse : l'utilisateur peut redemander.
    }
  }

  return {
    sent: sms.ok,
    provider: sms.provider,
    ttlSeconds: ttl,
    // Le code n'est renvoye que si l'echo de developpement est explicitement active.
    devCode: !env.isProd && env.OTP_DEV_ECHO ? code : undefined,
  };
}

/**
 * Verifie le code et cree/retourne l'utilisateur (inscription implicite).
 * @returns {Promise<{user: object, isNewUser: boolean}>}
 */
export async function verifyOtpCode({ phone, code, language = 'fr' }) {
  const row = await one(
    `SELECT * FROM otp_codes
     WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  if (!row) {
    throw badRequest('code_expired', 'Code expire ou introuvable', { voiceKey: 'error_code_expired' });
  }
  if (row.attempts >= row.max_attempts) {
    throw tooMany('code_attempts_exceeded', 'Trop de tentatives sur ce code', { voiceKey: 'error_code_invalid' });
  }
  if (!verifyOtp(code, phone, row.code_hash)) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    throw badRequest('code_invalid', 'Code incorrect', { voiceKey: 'error_code_invalid' });
  }

  await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);

  const existing = await one('SELECT * FROM users WHERE phone = $1', [phone]);
  let user = existing;
  let isNewUser = false;

  if (!existing) {
    user = await one(
      `INSERT INTO users (phone, phone_verified, language, last_seen_at)
       VALUES ($1, true, $2, now()) RETURNING *`,
      [phone, language],
    );
    isNewUser = true;
    logger.info({ userId: user.id }, 'Nouvel utilisateur inscrit');
  } else {
    user = await one(
      'UPDATE users SET phone_verified = true, last_seen_at = now() WHERE id = $1 RETURNING *',
      [existing.id],
    );
  }

  if (user.banned_at && (!user.ban_expires_at || new Date(user.ban_expires_at) > new Date())) {
    throw new AppError(403, 'banned', 'Compte suspendu', { voiceKey: 'account_banned' });
  }

  // Si le ban est expire, on le leve automatiquement.
  if (user.banned_at && user.ban_expires_at && new Date(user.ban_expires_at) <= new Date()) {
    user = await one('UPDATE users SET banned_at = NULL, ban_reason = NULL, ban_expires_at = NULL WHERE id = $1 RETURNING *', [
      user.id,
    ]);
  }

  return { user, isNewUser };
}

/** Purge des codes expires / consommes (cron quotidien). */
export async function purgeExpiredOtp() {
  const res = await query(`DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day'`);
  return res.rowCount;
}

export default { requestOtp, verifyOtpCode, purgeExpiredOtp, resolveOtpCode };
