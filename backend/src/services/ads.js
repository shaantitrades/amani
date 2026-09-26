import { many, one, query, tx } from '../lib/db.js';
import { notFound, forbidden, badRequest } from '../lib/errors.js';
import logger from '../lib/logger.js';

/**
 * Requetes du fil d'annonces, de la recherche et de la creation/moderation.
 * Toute lecture publique exclut :
 *   - les annonces non publiees (sauf proprietaire / admin)
 *   - les utilisateurs bloques (dans les deux sens)
 *   - les membres bannis du groupe courant
 */

export const AD_COLUMNS = `
  a.id, a.owner_id, a.group_id, a.category_id, a.kind, a.status,
  a.title, a.description_text, a.description_audio_key, a.description_audio_seconds,
  a.description_transcript, a.price_amount, a.currency, a.price_negotiable,
  a.district_id, a.city, a.lat, a.lng, a.views_count, a.photos_count,
  a.published_at, a.created_at, a.updated_at,
  c.code AS category_code, c.label_fr AS category_label_fr, c.label_ar AS category_label_ar,
  c.label_ff AS category_label_ff, c.label_sar AS category_label_sar, c.icon AS category_icon,
  c.color AS category_color,
  d.name AS district_name, d.name_ar AS district_name_ar,
  u.name AS owner_name, u.phone AS owner_phone, u.avatar_key AS owner_avatar_key,
  u.phone_verified AS owner_verified, u.language AS owner_language,
  (SELECT count(*)::int FROM ratings r WHERE r.ratee_id = u.id) AS owner_ratings_count,
  (SELECT round(avg(r.stars)::numeric, 1) FROM ratings r WHERE r.ratee_id = u.id) AS owner_rating_avg
`;

export const AD_JOINS = `
  FROM ads a
  JOIN categories c ON c.id = a.category_id
  JOIN users u ON u.id = a.owner_id
  LEFT JOIN districts d ON d.id = a.district_id
`;

export async function withPhotos(ads) {
  if (!ads.length) return ads;
  const ids = ads.map((a) => a.id);
  const photos = await many(
    `SELECT ad_id, storage_key, thumb_key, width, height, sort_order
     FROM ad_photos WHERE ad_id = ANY($1::uuid[]) ORDER BY sort_order ASC`,
    [ids],
  );
  const byAd = new Map();
  for (const p of photos) {
    if (!byAd.has(p.ad_id)) byAd.set(p.ad_id, []);
    byAd.get(p.ad_id).push(p);
  }
  return ads.map((a) => ({ ...a, photos: byAd.get(a.id) || [] }));
}

/** Fil principal / recherche : annonces publiees filtrees. */
export async function listAdFeed(opts = {}) {
  const {
    viewerId = null,
    categoryId = null,
    districtId = null,
    includeUnknown = false,
    kind = null,
    groupId = null,
    minPrice = null,
    maxPrice = null,
    q = null,
    ownerId = null,
    blockedIds = [],
    limit = 20,
    offset = 0,
  } = opts;

  const params = [];
  const conditions = ["a.status = 'published'"];

  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };

  if (categoryId) add('a.category_id = ?', categoryId);
  if (districtId) {
    // Fil d'accueil : le quartier du profil sert de repere, pas de filtre strict.
    // La majorite des vendeurs (bergers, zones rurales) n'ont pas de quartier : les
    // exclure donnerait un fil presque vide et ferait croire que personne ne vend.
    add(includeUnknown ? '(a.district_id = ? OR a.district_id IS NULL)' : 'a.district_id = ?', districtId);
  }
  if (kind) add('a.kind = ?', kind);
  if (groupId) add('a.group_id = ?', groupId);
  if (ownerId) add('a.owner_id = ?', ownerId);
  if (minPrice !== null && minPrice !== undefined) add('a.price_amount >= ?', minPrice);
  if (maxPrice !== null && maxPrice !== undefined) add('a.price_amount <= ?', maxPrice);
  if (q) {
    params.push(`%${String(q).trim()}%`);
    const p = `$${params.length}`;
    conditions.push(`(a.title ILIKE ${p} OR a.description_text ILIKE ${p} OR a.description_transcript ILIKE ${p})`);
  }
  if (blockedIds.length) add('a.owner_id <> ALL(?::uuid[])', blockedIds);
  if (viewerId) {
    add(
      'NOT EXISTS (SELECT 1 FROM group_bans gb WHERE gb.group_id = a.group_id AND gb.user_id = ?)',
      viewerId,
    );
  }
  // Confidentialite des groupes prives : une annonce publiee dans un groupe prive
  // n'apparait dans les fils publics que pour ses membres actifs. Les annonces
  // hors groupe et celles des groupes publics restent visibles de tous.
  if (!groupId) {
    const publicCondition =
      `a.group_id IS NULL
       OR EXISTS (SELECT 1 FROM groups g WHERE g.id = a.group_id AND g.is_private = false)`;
    if (viewerId) {
      add(
        `(${publicCondition}
          OR EXISTS (SELECT 1 FROM group_members m
                     WHERE m.group_id = a.group_id AND m.user_id = ? AND m.status = 'active'))`,
        viewerId,
      );
    } else {
      conditions.push(`(${publicCondition})`);
    }
  }

  params.push(limit, offset);
  const rows = await many(
    `SELECT ${AD_COLUMNS} ${AD_JOINS}
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.published_at DESC NULLS LAST, a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return withPhotos(rows);
}

export async function countFeed(opts = {}) {
  const {
    categoryId = null,
    districtId = null,
    includeUnknown = false,
    kind = null,
    groupId = null,
    blockedIds = [],
  } = opts;
  const params = [];
  const conditions = ["a.status = 'published'"];
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };
  if (categoryId) add('a.category_id = ?', categoryId);
  if (districtId) {
    add(includeUnknown ? '(a.district_id = ? OR a.district_id IS NULL)' : 'a.district_id = ?', districtId);
  }
  if (kind) add('a.kind = ?', kind);
  if (groupId) add('a.group_id = ?', groupId);
  if (blockedIds.length) add('a.owner_id <> ALL(?::uuid[])', blockedIds);
  const row = await one(`SELECT count(*)::int AS total FROM ads a WHERE ${conditions.join(' AND ')}`, params);
  return row?.total || 0;
}

/** Detail d'une annonce (proprietaire et admin voient aussi les non publiees). */
export async function getAdById(adId, { viewerId = null, isAdmin = false } = {}) {
  const params = [adId];
  const conditions = ['a.id = $1'];
  if (!isAdmin) {
    if (viewerId) {
      params.push(viewerId);
      conditions.push(`(a.status = 'published' OR a.owner_id = $${params.length})`);
    } else {
      conditions.push(`a.status = 'published'`);
    }
  }
  const row = await one(`SELECT ${AD_COLUMNS} ${AD_JOINS} WHERE ${conditions.join(' AND ')}`, params);
  if (!row || row.status === 'deleted') return null;
  const [withMedia] = await withPhotos([row]);
  return withMedia;
}

export async function listOwnerAds(ownerId, { statuses = null, limit = 30, offset = 0 } = {}) {
  const params = [ownerId];
  const conditions = ['a.owner_id = $1', `a.status <> 'deleted'`];
  if (statuses?.length) {
    params.push(statuses);
    conditions.push(`a.status = ANY($${params.length}::ad_status[])`);
  }
  params.push(limit, offset);
  const rows = await many(
    `SELECT ${AD_COLUMNS} ${AD_JOINS}
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return withPhotos(rows);
}

export async function incrementViews(adId) {
  await query('UPDATE ads SET views_count = views_count + 1 WHERE id = $1', [adId]);
}

/**
 * Cree une annonce.
 * Idempotent via client_uuid : indispensable pour la file de publication hors ligne.
 */
export async function createAd({ ownerId, payload, photos = [], status = 'published' }) {
  // published_at est calcule ici : utiliser deux fois $5 (statut + comparaison)
  // provoque une incoherence de type sur les enums PostgreSQL.
  const publishedAt = status === 'published' ? new Date() : null;

  const ad = await tx(async (client) => {
    if (payload.client_uuid) {
      const existing = await client.query('SELECT * FROM ads WHERE owner_id = $1 AND client_uuid = $2', [
        ownerId,
        payload.client_uuid,
      ]);
      if (existing.rows[0]) return { ...existing.rows[0], _duplicate: true };
    }

    const res = await client.query(
      `INSERT INTO ads (
         owner_id, group_id, category_id, kind, status, title, description_text,
         description_audio_key, description_audio_seconds, description_transcript,
         price_amount, currency, price_negotiable, district_id, city, lat, lng,
         contact_phone, client_uuid, published_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17,
         $18, $19, $20
       ) RETURNING *`,
      [
        ownerId,
        payload.group_id || null,
        payload.category_id,
        payload.kind || 'sell',
        status,
        payload.title || null,
        payload.description_text || null,
        payload.description_audio_key || null,
        payload.description_audio_seconds || null,
        payload.description_transcript || null,
        payload.price_amount ?? null,
        payload.currency || 'XAF',
        payload.price_negotiable !== false,
        payload.district_id || null,
        payload.city || null,
        payload.lat ?? null,
        payload.lng ?? null,
        payload.contact_phone || null,
        payload.client_uuid || null,
        publishedAt,
      ],
    );
    const created = res.rows[0];

    let order = 0;
    for (const photo of photos) {
      await client.query(
        `INSERT INTO ad_photos (ad_id, storage_key, thumb_key, width, height, size_bytes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          created.id,
          photo.storage_key,
          photo.thumb_key || null,
          photo.width || null,
          photo.height || null,
          photo.size_bytes || null,
          order,
        ],
      );
      order += 1;
    }
    if (photos.length) {
      await client.query('UPDATE ads SET photos_count = $2 WHERE id = $1', [created.id, photos.length]);
      created.photos_count = photos.length;
    }

    const keys = [payload.description_audio_key, ...photos.map((p) => p.storage_key)].filter(Boolean);
    if (keys.length) {
      await client.query(
        `UPDATE media_assets SET ad_id = $2, is_orphan = false WHERE storage_key = ANY($1::text[])`,
        [keys, created.id],
      );
    }
    return created;
  });

  const full = await getAdById(ad.id, { viewerId: ownerId });
  if (ad._duplicate) return { ad: full, duplicate: true };
  logger.info({ adId: ad.id, ownerId }, 'Annonce creee');
  return { ad: full, duplicate: false };
}

/** Colonnes qu'un proprietaire peut corriger apres publication. */
const EDITABLE_AD_COLUMNS = {
  title: 'title',
  description_text: 'description_text',
  description_audio_key: 'description_audio_key',
  description_audio_seconds: 'description_audio_seconds',
  description_transcript: 'description_transcript',
  price_amount: 'price_amount',
  currency: 'currency',
  price_negotiable: 'price_negotiable',
  category_id: 'category_id',
  district_id: 'district_id',
  city: 'city',
  lat: 'lat',
  lng: 'lng',
};

/**
 * Modification d'une annonce publiee (bouton "Modifier" de la fiche annonce).
 *
 * Seul le proprietaire (ou un administrateur de la plateforme) peut corriger son
 * annonce. Les champs absents du corps de la requete restent inchanges : le
 * client n'envoie que ce que l'utilisateur a touche, sans risque d'effacer le
 * reste (titre, voix, prix) en oubliant un champ.
 *
 * Une chaine vide vaut suppression de la valeur (titre efface, prix retire) :
 * sans cette regle, il serait impossible de retirer un prix ou une description.
 *
 * Les photos envoyees remplacent la liste existante : celles qui disparaissent
 * sont marquees orphelines (nettoyage du stockage) et les nouvelles rattachees a
 * l'annonce.
 *
 * Effet volontairement absent : `published_at` n'est pas retouche. Republier a
 * chaque correction permettrait a un vendeur de faire remonter sans fin son
 * annonce en tete du fil.
 */
export async function updateAd({ adId, actorId, isAdmin = false, payload = {}, photos = null }) {
  const ad = await one('SELECT id, owner_id, status FROM ads WHERE id = $1', [adId]);
  if (!ad || ad.status === 'deleted') throw notFound('ad_not_found', 'Annonce introuvable');
  if (ad.owner_id !== actorId && !isAdmin) {
    throw forbidden('not_ad_owner', "Vous n'etes pas le proprietaire de cette annonce");
  }

  const fields = Object.keys(EDITABLE_AD_COLUMNS).filter((key) => payload[key] !== undefined);
  if (!fields.length && !photos) throw badRequest('nothing_to_update', 'Aucune modification transmise');

  await tx(async (client) => {
    if (fields.length) {
      const params = [adId];
      const sets = fields.map((key) => {
        const value = payload[key];
        params.push(value === '' ? null : value);
        return `${EDITABLE_AD_COLUMNS[key]} = $${params.length}`;
      });
      await client.query(`UPDATE ads SET ${sets.join(', ')} WHERE id = $1`, params);
    }

    if (photos) {
      const previous = await client.query('SELECT storage_key FROM ad_photos WHERE ad_id = $1', [adId]);
      const keptKeys = new Set(photos.map((photo) => photo.storage_key));
      const removed = previous.rows.map((row) => row.storage_key).filter((key) => !keptKeys.has(key));

      await client.query('DELETE FROM ad_photos WHERE ad_id = $1', [adId]);
      let order = 0;
      for (const photo of photos) {
        await client.query(
          `INSERT INTO ad_photos (ad_id, storage_key, thumb_key, width, height, size_bytes, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            adId,
            photo.storage_key,
            photo.thumb_key || null,
            photo.width || null,
            photo.height || null,
            photo.size_bytes || null,
            order,
          ],
        );
        order += 1;
      }
      await client.query('UPDATE ads SET photos_count = $2 WHERE id = $1', [adId, photos.length]);

      const keys = photos.map((photo) => photo.storage_key);
      if (keys.length) {
        await client.query('UPDATE media_assets SET ad_id = $2, is_orphan = false WHERE storage_key = ANY($1::text[])', [
          keys,
          adId,
        ]);
      }
      if (removed.length) {
        await client.query('UPDATE media_assets SET is_orphan = true WHERE storage_key = ANY($1::text[])', [removed]);
      }
    }
  });

  logger.info({ adId, actorId, fields }, 'Annonce modifiee');
  return getAdById(adId, { viewerId: actorId, isAdmin });
}

const ALLOWED_STATUSES = ['draft', 'pending', 'published', 'rejected', 'sold', 'archived', 'deleted'];

/** Changement de statut (proprietaire, admin plateforme ou admin de groupe). */
export async function updateAdStatus({
  adId,
  actorId,
  isAdmin = false,
  isGroupAdminOf = false,
  status,
  moderationNote = null,
}) {
  const ad = await one('SELECT * FROM ads WHERE id = $1', [adId]);
  if (!ad || ad.status === 'deleted') throw notFound('ad_not_found', 'Annonce introuvable');

  const isOwner = ad.owner_id === actorId;
  if (!isOwner && !isAdmin && !isGroupAdminOf) {
    throw forbidden('not_ad_owner', "Vous n'etes pas le proprietaire de cette annonce");
  }
  if (!ALLOWED_STATUSES.includes(status)) throw badRequest('bad_status', 'Statut invalide');
  if (!isOwner && !isAdmin && !['deleted', 'rejected'].includes(status)) {
    throw forbidden('group_admin_status_restricted', 'Un administrateur de groupe peut seulement supprimer cette annonce');
  }

  const updated = await one(
    `UPDATE ads
     SET status = $2,
         moderation_note = COALESCE($3, moderation_note),
         published_at = CASE WHEN $4 THEN now() ELSE published_at END,
         sold_at = CASE WHEN $5 THEN now() ELSE sold_at END
     WHERE id = $1 RETURNING *`,
    [adId, status, moderationNote, status === 'published' && !ad.published_at, status === 'sold'],
  );

  if (['deleted', 'archived'].includes(status)) {
    await query(`UPDATE media_assets SET is_orphan = true WHERE ad_id = $1`, [adId]);
  }
  logger.info({ adId, actorId, status }, 'Statut annonce modifie');
  return updated;
}

/** Statistiques affichees dans "Mon compte". */
export async function ownerStats(ownerId) {
  return one(
    `SELECT
       count(*) FILTER (WHERE status = 'published')::int AS published,
       count(*) FILTER (WHERE status = 'sold')::int AS sold,
       coalesce(sum(views_count), 0)::int AS total_views,
       (SELECT count(*)::int FROM ratings WHERE ratee_id = $1) AS ratings_count,
       (SELECT round(avg(stars)::numeric, 1) FROM ratings WHERE ratee_id = $1) AS rating_avg
     FROM ads WHERE owner_id = $1`,
    [ownerId],
  );
}

/** Verifie qu'un utilisateur est administrateur actif d'un groupe. */
export async function isGroupAdmin(groupId, userId) {
  if (!groupId || !userId) return false;
  const row = await one(
    `SELECT 1 AS ok FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin' AND status = 'active'`,
    [groupId, userId],
  );
  return Boolean(row);
}

export default {
  listAdFeed,
  countFeed,
  getAdById,
  listOwnerAds,
  createAd,
  updateAd,
  updateAdStatus,
  incrementViews,
  ownerStats,
  isGroupAdmin,
  withPhotos,
};