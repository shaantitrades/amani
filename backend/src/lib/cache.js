import Redis from 'ioredis';
import env from '../config/env.js';
import logger from './logger.js';

/**
 * Cache a abstraction tolerante aux pannes :
 *  - avec Redis : OTP, liste de blocages, compteurs de vues, rate limiting
 *  - sans Redis (dev/tests) : repli en memoire, l'API reste fonctionnelle.
 */

let client = null;
let ready = false;

function memoryStore() {
  const store = new Map();
  const timers = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [key, entry] of store) if (entry.exp && entry.exp <= now) store.delete(key);
  };
  return {
    kind: 'memory',
    async get(key) {
      prune();
      const e = store.get(key);
      return e ? e.value : null;
    },
    async set(key, value, ttlSeconds) {
      store.set(key, { value: String(value), exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
      return 'OK';
    },
    async del(...keys) {
      const flat = keys.flat();
      flat.forEach((k) => store.delete(k));
      return flat.length;
    },
    async incr(key, ttlSeconds) {
      prune();
      const e = store.get(key);
      const next = e ? Number(e.value) + 1 : 1;
      store.set(key, { value: String(next), exp: e?.exp || (ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0) });
      return next;
    },
    async expire(key, ttlSeconds) {
      const e = store.get(key);
      if (!e) return 0;
      e.exp = Date.now() + ttlSeconds * 1000;
      return 1;
    },
    async sadd(key, member) {
      const e = store.get(key) || { value: new Set(), exp: 0 };
      e.value.add(String(member));
      store.set(key, e);
      return 1;
    },
    async srem(key, member) {
      const e = store.get(key);
      if (!e) return 0;
      e.value.delete(String(member));
      return 1;
    },
    async smembers(key) {
      const e = store.get(key);
      return e ? [...e.value] : [];
    },
    async ttl(key) {
      const e = store.get(key);
      if (!e || !e.exp) return -1;
      return Math.max(0, Math.round((e.exp - Date.now()) / 1000));
    },
    async flushdb() {
      store.forEach((_, k) => store.delete(k));
      timers.forEach((t) => clearTimeout(t));
      return 'OK';
    },
  };
}

const fallback = memoryStore();
let cache = fallback;

export function initCache() {
  if (env.NODE_ENV === 'test' || process.env.DISABLE_REDIS === '1') {
    logger.warn('Cache memoire actif (NODE_ENV=test ou DISABLE_REDIS=1)');
    return cache;
  }
  try {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    client.on('ready', () => {
      ready = true;
      cache = client;
      logger.info('Redis connecte');
    });
    client.on('error', (err) => {
      if (ready) logger.warn({ err: err.message }, 'Redis en erreur - repli memoire pour les lectures critiques');
    });
    client.connect().catch((err) => {
      logger.warn({ err: err.message }, 'Redis indisponible - repli memoire');
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'Initialisation Redis impossible - repli memoire');
  }
  return cache;
}

/** Retourne le magasin actif (Redis si pret, sinon memoire). */
export function getCache() {
  return cache;
}

/** Client ioredis brut, ou null si indisponible (pour rate-limit-redis). */
export function getRawRedis() {
  return ready ? client : null;
}

export function isRedisReady() {
  return ready;
}

export async function closeCache() {
  if (client) {
    try {
      await client.quit();
    } catch {
      /* ignore */
    }
  }
}

export const keys = {
  otpRatePhone: (phone) => `otp:rl:phone:${phone}`,
  otpRateIp: (ip) => `otp:rl:ip:${ip}`,
  blocks: (userId) => `blocks:${userId}`,
  adViews: (adId) => `views:ad:${adId}`,
  feedCache: (hash) => `feed:${hash}`,
  smsIdem: (hash) => `sms:${hash}`,
};

export default { initCache, getCache, getRawRedis, isRedisReady, closeCache, keys };
