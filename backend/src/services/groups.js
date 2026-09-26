import { many, one, query } from '../lib/db.js';
import { notFound, forbidden, badRequest } from '../lib/errors.js';

/** Groupes : creation, adhesion, fil d'annonces, moderation par l'admin du groupe. */

export async function createGroup({ ownerId, payload }) {
  const group = await one(
    `INSERT INTO groups (
       name, name_audio_key, description_text, description_audio_key, cover_key,
       city, district_id, is_private, owner_id, members_count
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1) RETURNING *`,
    [
      payload.name?.slice(0, 120) || 'Groupe',
      payload.name_audio_key || null,
      payload.description_text || null,
      payload.description_audio_key || null,
      payload.cover_key || null,
      payload.city || null,
      payload.district_id || null,
      Boolean(payload.is_private),
      ownerId,
    ],
  );
  await query(
    `INSERT INTO group_members (group_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active')
     ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'admin', status = 'active'`,
    [group.id, ownerId],
  );
  return group;
}

export async function listGroups({ viewerId = null, q = null, city = null, mine = false, limit = 30, offset = 0 }) {
  const params = [];
  const conditions = ['g.is_active'];
  let viewerParam = null;

  if (viewerId) {
    params.push(viewerId);
    viewerParam = params.length;
  }
  if (mine) {
    conditions.push(
      `EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $${viewerParam} AND m.status = 'active')`,
    );
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    conditions.push(`(g.name ILIKE $${params.length} OR g.description_text ILIKE $${params.length})`);
  }
  if (city) {
    params.push(city);
    conditions.push(`g.city = $${params.length}`);
  }
  if (viewerParam) {
    conditions.push(
      `(g.is_private = false OR g.owner_id = $${viewerParam}
        OR EXISTS (SELECT 1 FROM group_members m2 WHERE m2.group_id = g.id AND m2.user_id = $${viewerParam} AND m2.status = 'active'))`,
    );
    conditions.push(`NOT EXISTS (SELECT 1 FROM group_bans gb WHERE gb.group_id = g.id AND gb.user_id = $${viewerParam})`);
  } else {
    conditions.push('g.is_private = false');
  }

  params.push(limit, offset);
  const membershipSelect = viewerParam
    ? `(SELECT m3.status::text FROM group_members m3 WHERE m3.group_id = g.id AND m3.user_id = $${viewerParam}) AS my_status,
       (SELECT m4.role::text FROM group_members m4 WHERE m4.group_id = g.id AND m4.user_id = $${viewerParam}) AS my_role`
    : `NULL::text AS my_status, NULL::text AS my_role`;

  return many(
    `SELECT g.*, d.name AS district_name,
            (SELECT count(*)::int FROM ads a WHERE a.group_id = g.id AND a.status = 'published') AS ads_count,
            ${membershipSelect}
     FROM groups g
     LEFT JOIN districts d ON d.id = g.district_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY g.members_count DESC, g.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export async function getGroup(groupId, viewerId = null) {
  const group = await one(
    `SELECT g.*, d.name AS district_name
     FROM groups g LEFT JOIN districts d ON d.id = g.district_id
     WHERE g.id = $1 AND g.is_active`,
    [groupId],
  );
  if (!group) throw notFound('group_not_found', 'Groupe introuvable');

  if (viewerId) {
    const banned = await one('SELECT 1 AS b FROM group_bans WHERE group_id = $1 AND user_id = $2', [groupId, viewerId]);
    if (banned) throw forbidden('group_banned', 'Vous avez ete exclu de ce groupe', { voiceKey: 'error_banned' });
  }

  if (group.is_private) {
    const member = viewerId
      ? await one(`SELECT 1 AS m FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = 'active'`, [
          groupId,
          viewerId,
        ])
      : null;
    if (!member) throw forbidden('group_private', 'Ce groupe est prive');
  }

  const membership = viewerId
    ? await one(
        'SELECT role::text AS role, status::text AS status FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, viewerId],
      )
    : null;
  return { ...group, membership };
}

export async function joinGroup(groupId, userId) {
  const group = await one('SELECT 1 AS ok FROM groups WHERE id = $1 AND is_active', [groupId]);
  if (!group) throw notFound('group_not_found', 'Groupe introuvable');
  const banned = await one('SELECT 1 AS b FROM group_bans WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  if (banned) throw forbidden('group_banned', 'Vous avez ete exclu de ce groupe');
  await query(
    `INSERT INTO group_members (group_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')
     ON CONFLICT (group_id, user_id) DO UPDATE SET status = 'active'`,
    [groupId, userId],
  );
  await refreshMemberCount(groupId);
  return { joined: true };
}

export async function leaveGroup(groupId, userId) {
  const res = await query(
    `UPDATE group_members SET status = 'left' WHERE group_id = $1 AND user_id = $2 AND role <> 'admin' RETURNING *`,
    [groupId, userId],
  );
  if (res.rowCount === 0) throw badRequest('owner_cannot_leave', "L'administrateur ne peut pas quitter son groupe");
  await refreshMemberCount(groupId);
  return { left: true };
}

/** Exclut un membre (bannissement de groupe) - action reservee a l'admin. */
export async function banMember({ groupId, memberId, adminId, reason = null }) {
  const admin = await one(
    `SELECT 1 AS ok FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin' AND status = 'active'`,
    [groupId, adminId],
  );
  if (!admin) throw forbidden('not_group_admin', "Seul l'administrateur du groupe peut exclure un membre");
  if (memberId === adminId) throw badRequest('cannot_ban_self', 'Vous ne pouvez pas vous exclure vous-meme');

  await query(
    `INSERT INTO group_bans (group_id, user_id, banned_by, reason) VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by`,
    [groupId, memberId, adminId, reason],
  );
  await query(`UPDATE group_members SET status = 'banned' WHERE group_id = $1 AND user_id = $2`, [groupId, memberId]);
  await refreshMemberCount(groupId);
  return { banned: true };
}

export async function unbanMember({ groupId, memberId, adminId }) {
  const admin = await one(
    `SELECT 1 AS ok FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin' AND status = 'active'`,
    [groupId, adminId],
  );
  if (!admin) throw forbidden('not_group_admin', "Seul l'administrateur du groupe peut le faire");
  await query('DELETE FROM group_bans WHERE group_id = $1 AND user_id = $2', [groupId, memberId]);
  await query(`UPDATE group_members SET status = 'left' WHERE group_id = $1 AND user_id = $2`, [groupId, memberId]);
  return { unbanned: true };
}

export async function listMembers(groupId, { limit = 50, offset = 0 } = {}) {
  return many(
    `SELECT u.id, u.name, u.phone, u.avatar_key, u.phone_verified, d.name AS district_name,
            m.role::text AS role, m.status::text AS status, m.joined_at
     FROM group_members m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN districts d ON d.id = u.district_id
     WHERE m.group_id = $1 AND m.status = 'active'
     ORDER BY m.role DESC, m.joined_at ASC
     LIMIT $2 OFFSET $3`,
    [groupId, limit, offset],
  );
}

/** Destinataires des notifications (membres actifs, hors auteur du post). */
export async function activeMemberIds(groupId, excludeUserId = null) {
  const rows = await many(
    `SELECT user_id FROM group_members
     WHERE group_id = $1 AND status = 'active' AND muted = false
       AND ($2::uuid IS NULL OR user_id <> $2::uuid)`,
    [groupId, excludeUserId],
  );
  return rows.map((r) => r.user_id);
}

export async function isActiveMember(groupId, userId) {
  const row = await one(`SELECT 1 AS ok FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = 'active'`, [
    groupId,
    userId,
  ]);
  return Boolean(row);
}

async function refreshMemberCount(groupId) {
  await query(
    `UPDATE groups SET members_count = (
       SELECT count(*)::int FROM group_members WHERE group_id = $1 AND status = 'active'
     ) WHERE id = $1`,
    [groupId],
  );
}

export default {
  createGroup,
  listGroups,
  getGroup,
  joinGroup,
  leaveGroup,
  banMember,
  unbanMember,
  listMembers,
  activeMemberIds,
  isActiveMember,
};