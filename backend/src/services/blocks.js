import { one, many, query } from '../lib/db.js';
import { getCache, keys } from '../lib/cache.js';
import logger from '../lib/logger.js';

/**
 * Blocage utilisateur (🚫) - fonctionnalite cle du MVP.
 * Le blocage est symetrique en lecture : ni moi ni l'autre ne voyons nos contenus.
 */

const TTL_SECONDS = 60;

/** IDs des utilisateurs a masquer pour `userId` (bloques + ceux qui m'ont bloque). */
export async function getBlockedIds(userId) {
  if (!userId) return [];
  const cache = getCache();
  const cacheKey = keys.blocks(userId);
  try {
    const cached = await cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {
    /* cache indisponible : on continue */
  }
  const rows = await many(
    `SELECT blocked_id AS id FROM blocks WHERE blocker_id = $1
     UNION
     SELECT blocker_id AS id FROM blocks WHERE blocked_id = $1`,
    [userId],
  );
  const ids = rows.map((r) => r.id);
  try {
    await cache.set(cacheKey, JSON.stringify(ids), TTL_SECONDS);
  } catch {
    /* ignore */
  }
  return ids;
}

export async function invalidateBlockCache(userId) {
  if (!userId) return;
  try {
    await getCache().del(keys.blocks(userId));
  } catch {
    /* ignore */
  }
}

export async function isBlocked(userId, otherId) {
  if (!userId || !otherId) return false;
  const row = await one(
    `SELECT 1 AS blocked FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
     LIMIT 1`,
    [userId, otherId],
  );
  return Boolean(row);
}

export async function blockUser({ blockerId, blockedId, reason = null }) {
  await query(
    `INSERT INTO blocks (blocker_id, blocked_id, reason) VALUES ($1, $2, $3)
     ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET reason = EXCLUDED.reason`,
    [blockerId, blockedId, reason],
  );
  await invalidateBlockCache(blockerId);
  await invalidateBlockCache(blockedId);
  logger.info({ blockerId, blockedId }, 'Utilisateur bloque');
  return true;
}

export async function unblockUser({ blockerId, blockedId }) {
  const res = await query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
  await invalidateBlockCache(blockerId);
  await invalidateBlockCache(blockedId);
  return res.rowCount > 0;
}

export async function listBlocked(userId, { limit = 50, offset = 0 } = {}) {
  return many(
    `SELECT b.id AS block_id, b.created_at AS blocked_at, b.reason,
            u.id, u.phone, u.name, u.avatar_key, u.phone_verified, d.name AS district_name
     FROM blocks b
     JOIN users u ON u.id = b.blocked_id
     LEFT JOIN districts d ON d.id = u.district_id
     WHERE b.blocker_id = $1
     ORDER BY b.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
}

export default { getBlockedIds, blockUser, unblockUser, listBlocked, isBlocked, invalidateBlockCache };
