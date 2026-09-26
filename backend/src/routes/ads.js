import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../lib/db.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { limiters } from '../middleware/rateLimit.js';
import { readPage } from '../lib/pagination.js';
import { listAdFeed, getAdById, createAd, updateAd, updateAdStatus, incrementViews, isGroupAdmin } from '../services/ads.js';
import { isBlocked } from '../services/blocks.js';
import { notifyUser } from '../services/notifications.js';
import { activeMemberIds, isActiveMember } from '../services/groups.js';
import { dialable, formatPhone } from '../lib/phone.js';

const router = Router();

const photoSchema = z.object({
  storage_key: z.string().max(300),
  thumb_key: z.string().max(300).optional().nullable(),
  width: z.coerce.number().int().optional().nullable(),
  height: z.coerce.number().int().optional().nullable(),
  size_bytes: z.coerce.number().int().optional().nullable(),
});

const createSchema = z.object({
  category_id: z.string().uuid(),
  kind: z.enum(['sell', 'want']).default('sell'),
  group_id: z.string().uuid().optional().nullable(),
  title: z.string().max(120).optional().nullable(),
  description_text: z.string().max(2000).optional().nullable(),
  description_audio_key: z.string().max(300).optional().nullable(),
  description_audio_seconds: z.coerce.number().int().min(0).max(60).optional().nullable(),
  description_transcript: z.string().max(4000).optional().nullable(),
  price_amount: z.coerce.number().int().min(0).max(9_000_000_000).optional().nullable(),
  currency: z.enum(['XAF', 'USD', 'GOLD']).default('XAF'),
  price_negotiable: z.boolean().default(true),
  district_id: z.string().uuid().optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  lng: z.coerce.number().min(-180).max(180).optional().nullable(),
  contact_phone: z.string().max(24).optional().nullable(),
  client_uuid: z.string().uuid().optional().nullable(),
  photos: z.array(photoSchema).max(6).default([]),
});

/**
 * Champs corrigeables apres publication (bouton "Modifier" de la fiche annonce).
 * Tous facultatifs : le client n'envoie que ce que l'utilisateur a modifie.
 * `null` et `''` effacent une valeur (titre, prix, description, quartier).
 * `kind` et `group_id` sont volontairement absents : l'application ne publie
 * que des ventes et une annonce ne change pas de fil apres coup.
 */
const updateSchema = z.object({
  category_id: z.string().uuid().optional(),
  title: z.string().max(120).nullable().optional(),
  description_text: z.string().max(2000).nullable().optional(),
  description_audio_key: z.string().max(300).nullable().optional(),
  description_audio_seconds: z.coerce.number().int().min(0).max(60).nullable().optional(),
  description_transcript: z.string().max(4000).nullable().optional(),
  price_amount: z.coerce.number().int().min(0).max(9_000_000_000).nullable().optional(),
  currency: z.enum(['XAF', 'USD', 'GOLD']).optional(),
  price_negotiable: z.boolean().optional(),
  district_id: z.string().uuid().nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  lng: z.coerce.number().min(-180).max(180).optional().nullable(),
  photos: z.array(photoSchema).max(6).optional(),
});

/**
 * Fil principal (grille de photos type Pinterest).
 * Filtres par icones : categorie, quartier, type d'annonce, prix min/max.
 * `include_unknown=true` ajoute les annonces sans quartier : c'est ce que demande
 * l'accueil (le quartier du profil est un repere, pas un filtre strict), alors que
 * les filtres explicites de la recherche restent stricts.
 */
router.get(
  '/ads',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset } = readPage(req.query);
    const q = req.query;
    const items = await listAdFeed({
      viewerId: req.user?.id || null,
      blockedIds: req.blockedIds || [],
      categoryId: q.category_id || null,
      districtId: q.district_id || null,
      includeUnknown: q.include_unknown === 'true' || q.include_unknown === '1',
      kind: q.kind === 'sell' || q.kind === 'want' ? q.kind : null,
      groupId: q.group_id || null,
      minPrice: q.min_price !== undefined ? Number(q.min_price) : null,
      maxPrice: q.max_price !== undefined ? Number(q.max_price) : null,
      q: q.q || null,
      limit,
      offset,
    });
    res.set('Cache-Control', 'private, max-age=20');
    res.json({ items, page: { limit, offset, count: items.length } });
  }),
);

/** Vue detaillee : photos, prix, localisation, description vocale. */
router.get(
  '/ads/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const ad = await getAdById(req.params.id, { viewerId: req.user?.id, isAdmin: req.user?.is_admin });
    if (!ad) throw notFound('ad_not_found', 'Annonce introuvable');

    const blocked = req.user ? await isBlocked(req.user.id, ad.owner_id) : false;
    if (blocked) throw forbidden('user_blocked', 'Annonce indisponible', { voiceKey: 'error_blocked_target' });

    if (ad.status === 'published' && req.user?.id !== ad.owner_id) {
      incrementViews(ad.id).catch(() => {});
    }

    // Un membre banni de groupe ne voit plus le contenu du groupe
    if (ad.group_id && req.user) {
      const bannedRow = await one('SELECT 1 AS b FROM group_bans WHERE group_id = $1 AND user_id = $2', [
        ad.group_id,
        req.user.id,
      ]);
      if (bannedRow) throw forbidden('group_banned', 'Contenu indisponible', { voiceKey: 'error_banned' });
    }

    const isOwner = req.user?.id === ad.owner_id;
    res.json({
      ad,
      permissions: {
        is_owner: isOwner,
        can_call: !blocked,
        can_message: !blocked && !isOwner,
        can_report: !isOwner,
        can_moderate: Boolean(req.user?.is_admin),
      },
      safetyVoiceKey: 'safety_warning',
    });
  }),
);

/** Contact direct dans l'application : numero visible (aucun masquage) et
 *  appel `tel:`. La discussion passe par la messagerie de Bodogui, jamais par
 *  une application externe. */
router.get(
  '/ads/:id/contact',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ad = await one('SELECT id, owner_id, contact_phone, title FROM ads WHERE id = $1', [req.params.id]);
    if (!ad) throw notFound('ad_not_found', 'Annonce introuvable');
    if (await isBlocked(req.user.id, ad.owner_id)) {
      throw forbidden('user_blocked', 'Contact indisponible', { voiceKey: 'error_blocked_target' });
    }
    const owner = await one('SELECT phone, name FROM users WHERE id = $1', [ad.owner_id]);
    const phone = ad.contact_phone || owner?.phone;
    if (!phone) throw notFound('phone_missing', 'Numero indisponible');
    res.json({
      phone,
      phone_display: formatPhone(phone),
      tel_link: `tel:${dialable(phone)}`,
      owner_name: owner?.name || null,
    });
  }),
);

/**
 * Publication d'une annonce (photos + vocal + prix + localisation + categorie).
 * Idempotent : `client_uuid` permet de renvoyer une annonce preparee hors ligne
 * sans creer de doublon.
 */
router.post(
  '/ads',
  requireAuth,
  limiters.write(),
  validateBody(createSchema, { voiceKey: 'error_generic', message: 'Annonce incomplete' }),
  asyncHandler(async (req, res) => {
    const b = req.body;

    if (b.photos.length > 6) {
      throw badRequest('too_many_photos', 'Maximum 6 photos', { voiceKey: 'error_too_many_photos' });
    }
    // La description est facultative : la voix, le titre et le texte ne sont
    // jamais obligatoires. Photos + categorie + quartier suffisent a publier.

    const category = await one('SELECT id FROM categories WHERE id = $1 AND is_active', [b.category_id]);
    if (!category) throw badRequest('bad_category', 'Categorie invalide');

    // Publication dans un groupe : il faut etre membre actif et non banni
    if (b.group_id) {
      const banned = await one('SELECT 1 AS b FROM group_bans WHERE group_id = $1 AND user_id = $2', [
        b.group_id,
        req.user.id,
      ]);
      if (banned) throw forbidden('group_banned', 'Vous ne pouvez plus publier dans ce groupe');
      if (!(await isActiveMember(b.group_id, req.user.id))) {
        throw forbidden('not_group_member', 'Rejoignez le groupe pour publier');
      }
    }

    const { ad, duplicate } = await createAd({
      ownerId: req.user.id,
      payload: { ...b, contact_phone: b.contact_phone || req.user.phone },
      photos: b.photos,
      status: 'published',
    });

    if (!duplicate) {
      // Confirmation push (pas de SMS : economie)
      notifyUser({
        userId: req.user.id,
        kind: 'ad_published',
        title: 'Annonce publiee',
        body: 'Votre annonce est publiee.',
        voiceKey: 'ad_published',
        payload: { adId: ad.id },
      }).catch(() => {});

      // Membres du groupe (push systematique, SMS si le groupe est petit)
      if (b.group_id) {
        const group = await one('SELECT name, members_count FROM groups WHERE id = $1', [b.group_id]);
        const recipients = await activeMemberIds(b.group_id, req.user.id);
        const smsAllowed = recipients.length <= 30;
        for (const userId of recipients.slice(0, 200)) {
          notifyUser({
            userId,
            kind: 'group_post',
            smsTemplate: smsAllowed ? 'group_post' : null,
            smsVars: { group: group?.name || '' },
            title: group?.name || 'Groupe',
            body: 'Nouvelle annonce dans le groupe.',
            voiceKey: 'group_post',
            payload: { adId: ad.id, groupId: b.group_id },
          }).catch(() => {});
        }
      }
    }

    res.status(201).json({ ad, duplicate, voiceKey: 'ad_published' });
  }),
);

/**
 * Modification d'une annonce par son proprietaire (bouton "Modifier").
 * Le statut ne bouge pas : une annonce corrigee reste publiee (ou vendue), et
 * elle ne remonte pas en tete du fil (voir `updateAd`).
 */
router.patch(
  '/ads/:id',
  requireAuth,
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const { photos, ...payload } = req.body;
    const ad = await updateAd({
      adId: req.params.id,
      actorId: req.user.id,
      isAdmin: Boolean(req.user.is_admin),
      payload,
      photos: photos === undefined ? null : photos,
    });
    res.json({ ad, voiceKey: 'ad_updated' });
  }),
);

/** Je suis interesse : notifie le vendeur (SMS + push). */
router.post(
  '/ads/:id/interest',
  requireAuth,
  limiters.smsNotify(),
  asyncHandler(async (req, res) => {
    const ad = await one(
      `SELECT a.id, a.owner_id, a.status, a.title, c.label_fr AS category FROM ads a
       JOIN categories c ON c.id = a.category_id WHERE a.id = $1`,
      [req.params.id],
    );
    if (!ad) throw notFound('ad_not_found', 'Annonce introuvable');
    if (ad.owner_id === req.user.id) throw badRequest('own_ad', 'C\'est votre propre annonce');
    if (await isBlocked(req.user.id, ad.owner_id)) {
      throw forbidden('user_blocked', 'Action impossible', { voiceKey: 'error_blocked_target' });
    }

    await notifyUser({
      userId: ad.owner_id,
      kind: 'ad_interest',
      smsTemplate: 'ad_interest',
      smsVars: { category: ad.title || ad.category },
      title: 'Quelqu\'un est interesse',
      body: 'Quelqu\'un est interesse par votre annonce.',
      voiceKey: 'ad_interest',
      payload: { adId: ad.id, fromUserId: req.user.id },
    });

    res.status(202).json({ notified: true, voiceKey: 'interest_sent' });
  }),
);

/** Changement de statut : vendu, archive, supprime, republie. */
router.patch(
  '/ads/:id/status',
  requireAuth,
  validateBody(z.object({ status: z.enum(['published', 'sold', 'archived', 'deleted', 'pending']) })),
  asyncHandler(async (req, res) => {
    const ad = await one('SELECT id, owner_id, group_id FROM ads WHERE id = $1', [req.params.id]);
    if (!ad) throw notFound('ad_not_found', 'Annonce introuvable');

    const groupAdmin = ad.group_id ? await isGroupAdmin(ad.group_id, req.user.id) : false;
    const updated = await updateAdStatus({
      adId: ad.id,
      actorId: req.user.id,
      isAdmin: Boolean(req.user.is_admin),
      isGroupAdminOf: groupAdmin,
      status: req.body.status,
    });

    const voiceKey =
      { sold: 'ad_sold', deleted: 'ad_deleted', archived: 'ad_deleted', published: 'ad_published' }[req.body.status] ||
      'synced';
    res.json({ ad: updated, voiceKey });
  }),
);

/**
 * Rappel de securite vocal (anti-arnaque) : joue par le client au premier
 * affichage de la fiche contact.
 */
router.get(
  '/ads/:id/safety',
  asyncHandler(async (req, res) => {
    res.json({
      voiceKey: 'safety_warning',
      rules: [
        { key: 'never_pay_first', label_fr: "Ne payez jamais avant d'avoir vu le produit" },
        { key: 'public_place', label_fr: 'Rencontrez-vous dans un lieu public' },
        { key: 'check_product', label_fr: 'Verifiez le produit avant de payer' },
      ],
    });
  }),
);

export default router;