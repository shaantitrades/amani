/**
 * Visibilite et moderation : fragments SQL reutilisables.
 *
 * Regle metier : un utilisateur ne voit jamais le contenu d'un utilisateur
 * qu'il a bloque, ni celui d'un utilisateur qui l'a bloque (blocage symetrique).
 * Les annonces en attente de moderation ou rejetees sont masquees au public.
 */

/** Clause : exclut les utilisateurs bloques dans les deux sens. */
export function blockedUsersClause({ column, paramIndex, uid }) {
  if (!uid) return { sql: 'TRUE', params: [] };
  return {
    sql: `AND ${column} NOT IN (
      SELECT blocked_id FROM blocks WHERE blocker_id = $${paramIndex}
      UNION
      SELECT blocker_id FROM blocks WHERE blocked_id = $${paramIndex}
    )`,
    params: [uid],
  };
}

/** Clause : masque les membres bannis du groupe. */
export function notGroupBannedClause({ column, paramIndex }) {
  return {
    sql: `AND NOT EXISTS (SELECT 1 FROM group_bans gb WHERE gb.group_id = $${paramIndex - 1} AND gb.user_id = ${column})`,
    params: [],
  };
}

const AD_PUBLIC_STATUSES = ['published'];

/** Statuts visibles dans le fil public / la recherche. */
export const PUBLIC_AD_STATUSES = AD_PUBLIC_STATUSES;

/** Statuts que le proprietaire peut voir dans "Mes annonces". */
export const OWNER_AD_STATUSES = ['draft', 'pending', 'published', 'rejected', 'sold', 'archived'];

/**
 * Un utilisateur est banni si un enregistrement `bans` est actif
 * (non leve et non expire), ou si son champ users.banned_at est actif.
 */
export function activeBanCondition(alias = 'u') {
  return `(
    ${alias}.banned_at IS NOT NULL
    AND (${alias}.ban_expires_at IS NULL OR ${alias}.ban_expires_at > now())
  )`;
}

export function isBanExpired(ban, now = new Date()) {
  if (!ban) return true;
  if (ban.lifted_at) return true;
  if (!ban.expires_at) return false;
  return new Date(ban.expires_at).getTime() <= now.getTime();
}

/** Construit la liste des parametres de requete pour un fil d'annonces. */
export function buildAdFilters({ categoryId, districtId, kind, minPrice, maxPrice, groupId, ownerId, q } = {}) {
  const where = [];
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (categoryId) where.push(`a.category_id = ${push(categoryId)}`);
  if (districtId) where.push(`a.district_id = ${push(districtId)}`);
  if (kind) where.push(`a.kind = ${push(kind)}`);
  if (minPrice !== undefined && minPrice !== null) where.push(`a.price_amount >= ${push(minPrice)}`);
  if (maxPrice !== undefined && maxPrice !== null) where.push(`a.price_amount <= ${push(maxPrice)}`);
  if (groupId) where.push(`a.group_id = ${push(groupId)}`);
  if (ownerId) where.push(`a.owner_id = ${push(ownerId)}`);
  if (q) {
    const term = `%${String(q).trim()}%`;
    const p = push(term);
    where.push(`(a.title ILIKE ${p} OR a.description_text ILIKE ${p} OR a.description_transcript ILIKE ${p})`);
  }
  return { where, params, nextIndex: params.length + 1 };
}
