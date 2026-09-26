import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import env from '../config/env.js';
import { getRawRedis } from '../lib/cache.js';

/**
 * Limitation de debit : proteger l'API des abus (et des couts SMS).
 * Le magasin Redis est utilise quand il est disponible, sinon la memoire locale.
 */
function store(prefix) {
  const redis = getRawRedis();
  if (!redis) return undefined;
  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: `rl:${prefix}:`,
  });
}

export function makeLimiter({ windowMs, max, prefix, message, voiceKey = 'error_generic', keyGenerator }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store(prefix),
    keyGenerator: keyGenerator || ((req) => req.user?.id || req.ip),
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: message || 'Trop de requetes. Patientez un instant.',
          voiceKey,
        },
      });
    },
  });
}

/** Limiteurs prets a l'emploi. */
export const limiters = {
  global: () =>
    makeLimiter({
      windowMs: 60_000,
      max: 240,
      prefix: 'global',
      keyGenerator: (req) => req.ip,
    }),
  otpRequest: () =>
    makeLimiter({
      windowMs: 60 * 60 * 1000,
      max: env.OTP_PER_IP_PER_HOUR,
      prefix: 'otp-ip',
      keyGenerator: (req) => req.ip,
      voiceKey: 'error_code_rate_limited',
      message: 'Trop de demandes de code depuis ce reseau.',
    }),
  write: () =>
    makeLimiter({
      windowMs: 60_000,
      max: 30,
      prefix: 'write',
      voiceKey: 'error_rate_limited',
      message: 'Trop de publications. Attendez une minute.',
    }),
  media: () =>
    makeLimiter({
      windowMs: 60_000,
      max: 60,
      prefix: 'media',
      voiceKey: 'error_rate_limited',
    }),
  smsNotify: () =>
    makeLimiter({
      windowMs: 60 * 60 * 1000,
      max: 20,
      prefix: 'sms',
      voiceKey: 'error_rate_limited',
    }),
};

export default limiters;
