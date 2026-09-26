import crypto from 'node:crypto';
import env from '../config/env.js';

/**
 * Genere un code OTP numerique (par defaut 5 chiffres : facile a dicter en langues locales).
 */
export function generateOtp(length = 5, rand = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(rand(0, 10));
  return out;
}

/** HMAC-SHA256(code, secret) - jamais de code en clair dans la base. */
export function hashOtp(code, phone = '') {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`${code}:${phone}`).digest('hex');
}

/** Comparaison a temps constant. */
export function safeEqual(a = '', b = '') {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verifyOtp(code, phone, storedHash) {
  return safeEqual(hashOtp(code, phone), storedHash);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
