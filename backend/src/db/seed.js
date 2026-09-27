import crypto from 'node:crypto';
import { many, one, query, tx, closePool } from '../lib/db.js';
import logger from '../lib/logger.js';
import { storeDemoMedia } from './seed-assets.js';

/**
 * Jeu de donnees de test Bodogui.
 *
 * Ecrit en mode idempotent : relancer `npm run seed` ne cree pas de doublons.
 * Donnees couvrant le pilote : quartiers de N'Djamena (Moursal, Chagoua, Dembe),
 * categories, groupes, annonces avec photos et messages vocaux, un compte
 * administrateur, un utilisateur banni et une paire bloquee (pour tester le
 * filtrage de visibilite).
 *
 * Utilisation :
 *   npm run seed                      # insere / met a jour (referentiel + demonstration)
 *   npm run seed -- --reset           # supprime les donnees de demonstration puis reinsere
 *   npm run seed -- --reference-only  # production : categories + quartiers seulement,
 *                                     # sans comptes, annonces ni medias de demonstration
 */

const RESET = process.argv.includes('--reset');
/** Production : n'insere que le referentiel indispensable (categories, quartiers). */
const REFERENCE_ONLY = process.argv.includes('--reference-only');

const CATEGORIES = [
  { code: 'animaux', label_fr: 'Animaux', label_ar: 'حيوانات', label_ff: 'Dabbaaji', label_sar: 'Nyama', icon: '🐄', color: '#128C7E', sort_order: 10 },
  { code: 'voiture', label_fr: 'Voiture', label_ar: 'سيارة', label_ff: 'Mota', label_sar: 'Moto', icon: '🚗', color: '#075E54', sort_order: 20 },
  { code: 'moto', label_fr: 'Moto', label_ar: 'موتو', label_ff: 'Mooto', label_sar: 'Moto', icon: '🏍️', color: '#34B7F1', sort_order: 30 },
  { code: 'pieces', label_fr: 'Pièces détachées', label_ar: 'قطع غيار', label_ff: 'Feccere', label_sar: 'Pièces', icon: '🔧', color: '#5B4A3F', sort_order: 40 },
  { code: 'telephone', label_fr: 'Téléphone', label_ar: 'هاتف', label_ff: 'Telefoŋ', label_sar: 'Telefo', icon: '📱', color: '#25D366', sort_order: 50 },
  { code: 'vetements', label_fr: 'Vêtements', label_ar: 'ملابس', label_ff: 'Colli', label_sar: 'Colle', icon: '👕', color: '#C0392B', sort_order: 60 },
  { code: 'maison', label_fr: 'Maison / Terrain', label_ar: 'أرض', label_ff: 'Suudu', label_sar: 'Su', icon: '🏠', color: '#8E6E53', sort_order: 70 },
  { code: 'meubles', label_fr: 'Meubles', label_ar: 'أثاث', label_ff: 'Mobilije', label_sar: 'Meuble', icon: '🛋️', color: '#A0522D', sort_order: 80 },
  { code: 'autre', label_fr: 'Autre', label_ar: 'آخر', label_ff: 'Goɗɗum', label_sar: 'Duma', icon: '📦', color: '#607D8B', sort_order: 990 },
];

const DISTRICTS = [
  { name: 'Moursal', name_ar: 'مورسال', city: "N'Djamena", lat: 12.1150, lng: 15.0550, radius_km: 2.5, sort_order: 10 },
  { name: 'Chagoua', name_ar: 'شاغوا', city: "N'Djamena", lat: 12.0920, lng: 15.0720, radius_km: 2.5, sort_order: 20 },
  { name: 'Dembé', name_ar: 'دمبيه', city: "N'Djamena", lat: 12.1080, lng: 15.0330, radius_km: 2.5, sort_order: 30 },
  { name: 'Klemat', name_ar: 'كليما', city: "N'Djamena", lat: 12.1000, lng: 15.0180, radius_km: 2.0, sort_order: 40 },
  { name: 'Ardep-Djoumbal', name_ar: 'أرديب', city: "N'Djamena", lat: 12.1230, lng: 15.0450, radius_km: 2.0, sort_order: 50 },
  { name: 'Farcha', name_ar: 'فرشا', city: "N'Djamena", lat: 12.1400, lng: 15.0400, radius_km: 3.0, sort_order: 60 },
  { name: 'Paris Congo', name_ar: 'باريس كونغو', city: "N'Djamena", lat: 12.0980, lng: 15.0410, radius_km: 1.5, sort_order: 70 },
  { name: 'Atrone', name_ar: 'أتروني', city: "N'Djamena", lat: 12.1300, lng: 15.0700, radius_km: 2.0, sort_order: 80 },
];

// Numeros fictifs (plage volontairement inutilisable en production)
const DEMO_USERS = [
  { phone: '+23566000000', name: 'Support Bodogui', is_admin: true, language: 'fr', district: 'Moursal' },
  { phone: '+23566000001', name: 'Achta A.', language: 'fr', district: 'Moursal' },
  { phone: '+23566000002', name: 'Moussa B.', language: 'ar', district: 'Chagoua' },
  { phone: '+23566000003', name: 'Halime C.', language: 'fr', district: 'Dembé' },
  { phone: '+23566000004', name: 'Brahim D.', language: 'ff', district: 'Klemat' },
  { phone: '+23566000005', name: 'Ngarta E.', language: 'ff', district: 'Farcha' },
  { phone: '+23566000006', name: 'Ali F. (compte suspendu)', language: 'fr', district: 'Atrone' },
];

const DEMO_ADS = [
  { owner: 1, category: 'animaux', district: 'Moursal', kind: 'sell', title: 'Vache laitière robuste', price: 285000, icon: '🐄', label: 'Vache laitière' },
  { owner: 1, category: 'moto', district: 'Moursal', kind: 'sell', title: 'Moto Yadea 125 neuve', price: 415000, icon: '🏍️', label: 'Moto 125' },
  { owner: 2, category: 'telephone', district: 'Chagoua', kind: 'sell', title: 'Tecno Spark 10', price: 65000, icon: '📱', label: 'Tecno Spark' },
  { owner: 2, category: 'vetements', district: 'Chagoua', kind: 'sell', title: 'Boubou brodé homme', price: 15000, icon: '👕', label: 'Boubou brodé' },
  { owner: 3, category: 'maison', district: 'Dembé', kind: 'sell', title: 'Terrain 400 m² titré', price: 7000000, icon: '🏠', label: 'Terrain 400 m2' },
  { owner: 3, category: 'meubles', district: 'Dembé', kind: 'sell', title: 'Canapé 5 places', price: 120000, icon: '🛋️', label: 'Canapé 5 places' },
  { owner: 4, category: 'pieces', district: 'Klemat', kind: 'sell', title: 'Pièces Toyota Hilux', price: 45000, icon: '🔧', label: 'Pieces Hilux' },
  { owner: 4, category: 'animaux', district: 'Klemat', kind: 'want', title: 'Je cherche 2 moutons', price: 90000, icon: '🐐', label: 'Cherche moutons' },
  { owner: 5, category: 'voiture', district: 'Farcha', kind: 'sell', title: 'Toyota Corolla 2008', price: 3500000, icon: '🚗', label: 'Corolla 2008' },
  { owner: 5, category: 'telephone', district: 'Farcha', kind: 'want', title: 'Je cherche un smartphone', price: 50000, icon: '📱', label: 'Cherche telephone' },
];

const DEMO_GROUPS = [
  { name: 'Moursal Vente & Achat', owner: 1, district: 'Moursal', description: 'Groupe du quartier Moursal : annonces de proximité.' },
  { name: 'Animaux du Sahel', owner: 2, district: 'Chagoua', description: 'Vaches, chèvres, moutons et chameaux.' },
];

/** UUID deterministe : garantit l'idempotence du seed. */
function deterministicUuid(seed) {
  const chars = crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 32).split('');
  chars[12] = '4';
  return [
    chars.slice(0, 8).join(''),
    chars.slice(8, 12).join(''),
    chars.slice(12, 16).join(''),
    chars.slice(16, 20).join(''),
    chars.slice(20, 32).join(''),
  ].join('-');
}

async function upsertCategories() {
  const map = new Map();
  for (const c of CATEGORIES) {
    const row = await one(
      `INSERT INTO categories (code, label_fr, label_ar, label_ff, label_sar, icon, color, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (code) DO UPDATE
         SET label_fr = EXCLUDED.label_fr, label_ar = EXCLUDED.label_ar,
             label_ff = EXCLUDED.label_ff, label_sar = EXCLUDED.label_sar,
             icon = EXCLUDED.icon, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order
       RETURNING *`,
      [c.code, c.label_fr, c.label_ar, c.label_ff, c.label_sar, c.icon, c.color, c.sort_order],
    );
    map.set(c.code, row);
  }
  return map;
}

async function upsertDistricts() {
  const map = new Map();
  for (const d of DISTRICTS) {
    const row = await one(
      `INSERT INTO districts (name, name_ar, city, country, lat, lng, radius_km, sort_order)
       VALUES ($1,$2,$3,'TD',$4,$5,$6,$7)
       ON CONFLICT (city, name) DO UPDATE
         SET name_ar = EXCLUDED.name_ar, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
             radius_km = EXCLUDED.radius_km, sort_order = EXCLUDED.sort_order
       RETURNING *`,
      [d.name, d.name_ar, d.city, d.lat, d.lng, d.radius_km, d.sort_order],
    );
    map.set(d.name, row);
  }
  return map;
}

async function upsertUsers(districts) {
  const list = [];
  for (const u of DEMO_USERS) {
    const district = districts.get(u.district);
    const row = await one(
      `INSERT INTO users (phone, phone_verified, name, language, district_id, city, is_admin, last_seen_at)
       VALUES ($1, true, $2, $3, $4, $5, $6, now())
       ON CONFLICT (phone) DO UPDATE
         SET name = EXCLUDED.name, language = EXCLUDED.language,
             district_id = EXCLUDED.district_id, city = EXCLUDED.city,
             is_admin = EXCLUDED.is_admin, phone_verified = true
       RETURNING *`,
      [u.phone, u.name, u.language, district?.id || null, district?.city || "N'Djamena", Boolean(u.is_admin)],
    );
    list.push(row);
  }
  return list;
}

async function upsertGroups(users, districts) {
  const list = [];
  for (const g of DEMO_GROUPS) {
    const owner = users[g.owner];
    const district = districts.get(g.district);
    let row = await one('SELECT * FROM groups WHERE name = $1 AND owner_id = $2', [g.name, owner.id]);
    if (!row) {
      row = await one(
        `INSERT INTO groups (name, description_text, city, district_id, owner_id, is_private)
         VALUES ($1, $2, $3, $4, $5, false) RETURNING *`,
        [g.name, g.description, district?.city || "N'Djamena", district?.id || null, owner.id],
      );
    }
    await query(
      `INSERT INTO group_members (group_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active')
       ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'admin', status = 'active'`,
      [row.id, owner.id],
    );
    // Quelques membres pour rendre le fil vivant
    for (const u of users.slice(1, 5)) {
      if (u.id === owner.id) continue;
      await query(
        `INSERT INTO group_members (group_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')
         ON CONFLICT (group_id, user_id) DO UPDATE SET status = 'active'`,
        [row.id, u.id],
      );
    }
    await query(
      `UPDATE groups SET members_count = (SELECT count(*)::int FROM group_members WHERE group_id = $1 AND status = 'active')
       WHERE id = $1`,
      [row.id],
    );
    list.push(row);
  }
  return list;
}

/** Annonces de demonstration : photos WebP + message vocal + donnees completes. */
async function upsertAds(users, categories, districts) {
  const created = [];
  for (let i = 0; i < DEMO_ADS.length; i += 1) {
    const spec = DEMO_ADS[i];
    const owner = users[spec.owner];
    const category = categories.get(spec.category);
    const district = districts.get(spec.district);
    if (!owner || !category) continue;

    const clientUuid = deterministicUuid(`ad-${i}-${spec.title}`);
    const existing = await one('SELECT id FROM ads WHERE owner_id = $1 AND client_uuid = $2', [owner.id, clientUuid]);
    if (existing) {
      created.push(existing);
      continue;
    }

    const media = await storeDemoMedia({
      label: spec.label,
      icon: spec.icon,
      seed: i,
      ownerId: owner.id,
      scope: 'seed',
    });

    if (media) {
      const assets = [
        ['photo', media.photo.storage_key, media.photo.size_bytes, null],
        ['photo', media.photo.thumb_key, Math.round(media.photo.size_bytes * 0.3), null],
        ['audio', media.audio.key, media.audio.size_bytes, media.audio.seconds],
      ];
      for (const [kind, key, size, seconds] of assets) {
        if (!key) continue;
        await query(
          `INSERT INTO media_assets (owner_id, kind, storage_key, mime_type, size_bytes, seconds)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (storage_key) DO NOTHING`,
          [owner.id, kind, key, kind === 'photo' ? 'image/webp' : 'audio/wav', size || null, seconds],
        );
      }
    }

    const ad = await one(
      `INSERT INTO ads (
         owner_id, category_id, kind, status, title, description_text,
         description_audio_key, description_audio_seconds, price_amount, currency,
         price_negotiable, district_id, city, lat, lng, contact_phone, photos_count,
         client_uuid, published_at
       ) VALUES (
         $1, $2, $3, 'published', $4, $5,
         $6, $7, $8, 'XAF',
         true, $9, $10, $11, $12, $13, $14,
         $15, now() - ($16 || ' hours')::interval
       ) RETURNING *`,
      [
        owner.id,
        category.id,
        spec.kind,
        spec.title,
        `${spec.label} disponible a ${district?.name || "N'Djamena"}. Verifiez le produit avant de payer.`,
        media?.audio.key || null,
        media?.audio.seconds || null,
        spec.price,
        district?.id || null,
        district?.city || "N'Djamena",
        district?.lat || null,
        district?.lng || null,
        owner.phone,
        media ? 1 : 0,
        clientUuid,
        String(2 + i * 3),
      ],
    );

    if (media) {
      await query(
        `INSERT INTO ad_photos (ad_id, storage_key, thumb_key, width, height, size_bytes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, 0)`,
        [
          ad.id,
          media.photo.storage_key,
          media.photo.thumb_key,
          media.photo.width,
          media.photo.height,
          media.photo.size_bytes,
        ],
      );
      await query(`UPDATE media_assets SET ad_id = $2, is_orphan = false WHERE storage_key = ANY($1::text[])`, [
        [media.photo.storage_key, media.photo.thumb_key, media.audio.key].filter(Boolean),
        ad.id,
      ]);
    }

    created.push(ad);
  }
  return created;
}

/** Relations de demonstration : blocage, bannissement, notations, signalement. */
async function upsertRelations(users, ads) {
  // Achta bloque Brahim : leurs annonces disparaissent mutuellement.
  await query(
    `INSERT INTO blocks (blocker_id, blocked_id, reason) VALUES ($1, $2, 'Test de blocage')
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [users[1].id, users[4].id],
  );

  // Compte suspendu temporairement (demontre le message vocal de suspension).
  await query(
    `UPDATE users SET banned_at = now(), ban_reason = 'Annonces frauduleuses repetees',
       ban_expires_at = now() + interval '30 days' WHERE id = $1`,
    [users[6].id],
  );
  await query(
    `INSERT INTO bans (user_id, reason, expires_at, created_by)
     SELECT $1, 'Annonces frauduleuses repetees', now() + interval '30 days', $2
     WHERE NOT EXISTS (SELECT 1 FROM bans WHERE user_id = $1 AND lifted_at IS NULL)`,
    [users[6].id, users[0].id],
  );

  // Evaluations vocales apres transaction (systeme de confiance)
  for (const [raterIndex, rateeIndex, stars] of [
    [2, 1, 5],
    [3, 1, 4],
    [1, 2, 5],
    [5, 4, 4],
  ]) {
    await query(
      `INSERT INTO ratings (ad_id, rater_id, ratee_id, stars, comment)
       VALUES (NULL, $1, $2, $3, 'Transaction correcte, produit conforme.')`,
      [users[raterIndex].id, users[rateeIndex].id, stars],
    );
  }

  // Signalement d'une annonce (pour tester le tableau de bord de moderation)
  if (ads[8]) {
    await query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason_code, comment)
       VALUES ($1, 'ad', $2, 'scam', 'Prix trop bas, semble etre une arnaque.')
       ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [users[3].id, ads[8].id],
    );
  }
}

/** Supprime les donnees de demonstration (option --reset). */
async function resetDemoData() {
  const phones = DEMO_USERS.map((u) => u.phone);
  const users = await query('SELECT id FROM users WHERE phone = ANY($1::text[])', [phones]);
  const ids = users.rows.map((r) => r.id);
  if (ids.length) {
    await query('DELETE FROM groups WHERE owner_id = ANY($1::uuid[])', [ids]);
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  }
  logger.info('Donnees de demonstration supprimees');
}

async function run() {
  if (RESET) await resetDemoData();

  const categories = await upsertCategories();
  const districts = await upsertDistricts();

  // Production : le referentiel (categories, quartiers) est indispensable, les comptes et
  // annonces de demonstration ne le sont pas.
  if (REFERENCE_ONLY) {
    logger.info(
      { categories: categories.size, districts: districts.size },
      'Referentiel pret (sans donnees de demonstration)',
    );
    // eslint-disable-next-line no-console
    console.log(`
Bodogui : referentiel insere (aucune donnee de demonstration)
  - ${categories.size} categories, ${districts.size} quartiers de N'Djamena
`);
    return;
  }

  const users = await upsertUsers(districts);
  const groups = await upsertGroups(users, districts);
  const ads = await upsertAds(users, categories, districts);
  await upsertRelations(users, ads);

  logger.info(
    {
      categories: categories.size,
      districts: districts.size,
      users: users.length,
      groups: groups.length,
      ads: ads.length,
    },
    'Jeu de donnees de test pret',
  );
  // eslint-disable-next-line no-console
  console.log(`
Bodogui : donnees de test inserees
  - ${categories.size} categories, ${districts.size} quartiers de N'Djamena
  - ${users.length} comptes (administrateur : ${DEMO_USERS[0].phone})
  - ${groups.length} groupes, ${ads.length} annonces avec photos + messages vocaux
  - 1 utilisateur suspendu, 1 paire bloquee, 4 evaluations, 1 signalement
`);
}

run()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err: err.message, stack: err.stack }, 'Echec du seed');
    await closePool().catch(() => {});
    process.exit(1);
  });
