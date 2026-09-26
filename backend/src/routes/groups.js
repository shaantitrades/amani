import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../lib/db.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { limiters } from '../middleware/rateLimit.js';
import { uploadChatMedia } from '../middleware/upload.js';
import { readPage } from '../lib/pagination.js';
import env from '../config/env.js';
import {
  assertAudioSize,
  assertFileSize,
  detectAudio,
  detectDocument,
  estimateAudioSeconds,
  processPhoto,
  safeFileName,
} from '../services/media.js';
import { buildKey, putObject } from '../services/storage.js';
import {
  activeMemberIds,
  banMember,
  createGroup,
  getGroup,
  isActiveMember,
  joinGroup,
  leaveGroup,
  listGroups,
  listMembers,
  unbanMember,
} from '../services/groups.js';
import { listAdFeed, isGroupAdmin, updateAdStatus } from '../services/ads.js';
import { notifyUser } from '../services/notifications.js';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(120),
  name_audio_key: z.string().max(300).optional().nullable(),
  description_text: z.string().max(1000).optional().nullable(),
  description_audio_key: z.string().max(300).optional().nullable(),
  cover_key: z.string().max(300).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  district_id: z.string().uuid().optional().nullable(),
  is_private: z.boolean().default(false),
});

/** Creer un groupe (le createur devient administrateur). */
router.post(
  '/groups',
  requireAuth,
  limiters.write(),
  validateBody(createSchema, { voiceKey: 'error_generic', message: 'Informations du groupe incompletes' }),
  asyncHandler(async (req, res) => {
    if (!req.body.name && !req.body.name_audio_key) {
      throw badRequest('name_required', 'Nom du groupe requis');
    }
    const group = await createGroup({
      ownerId: req.user.id,
      payload: { ...req.body, name: req.body.name || 'Groupe' },
    });
    res.status(201).json({ group, voiceKey: 'group_created' });
  }),
);

/** Liste des groupes (publics + les membres voient les prives). */
router.get(
  '/groups',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset } = readPage(req.query);
    const items = await listGroups({
      viewerId: req.user?.id || null,
      q: req.query.q || null,
      city: req.query.city || null,
      mine: req.query.mine === '1' || req.query.mine === 'true',
      limit,
      offset,
    });
    res.json({ items, page: { limit, offset, count: items.length } });
  }),
);

/** Detail d'un groupe. */
router.get(
  '/groups/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json({ group: await getGroup(req.params.id, req.user?.id || null) });
  }),
);

router.post(
  '/groups/:id/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await joinGroup(req.params.id, req.user.id);
    const owner = await one('SELECT owner_id FROM groups WHERE id = $1', [req.params.id]);
    if (owner && owner.owner_id !== req.user.id) {
      notifyUser({
        userId: owner.owner_id,
        kind: 'group_join',
        title: 'Nouveau membre',
        body: `${req.user.name || req.user.phone} a rejoint votre groupe.`,
        voiceKey: 'group_join',
        payload: { groupId: req.params.id, userId: req.user.id },
      }).catch(() => {});
    }
    res.json({ ...result, voiceKey: 'group_joined' });
  }),
);

router.post(
  '/groups/:id/leave',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ ...(await leaveGroup(req.params.id, req.user.id)), voiceKey: 'group_left' });
  }),
);

/** Fil du groupe : annonces publiees par les membres. */
router.get(
  '/groups/:id/ads',
  optionalAuth,
  asyncHandler(async (req, res) => {
    await getGroup(req.params.id, req.user?.id || null);
    const { limit, offset } = readPage(req.query);
    const items = await listAdFeed({
      viewerId: req.user?.id || null,
      blockedIds: req.blockedIds || [],
      groupId: req.params.id,
      limit,
      offset,
    });
    res.json({ items, page: { limit, offset, count: items.length } });
  }),
);

/** Membres (visible par les membres du groupe uniquement). */
router.get(
  '/groups/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const isMember = await isActiveMember(req.params.id, req.user.id);
    const admin = await isGroupAdmin(req.params.id, req.user.id);
    if (!isMember && !admin) throw forbidden('not_group_member', 'Reserve aux membres du groupe');
    const { limit, offset } = readPage(req.query);
    res.json({ items: await listMembers(req.params.id, { limit, offset }) });
  }),
);

/** Moderation : exclure un membre (bouton simple cote client). */
router.post(
  '/groups/:id/members/:userId/ban',
  requireAuth,
  validateBody(z.object({ reason: z.string().max(200).optional() })),
  asyncHandler(async (req, res) => {
    const result = await banMember({
      groupId: req.params.id,
      memberId: req.params.userId,
      adminId: req.user.id,
      reason: req.body.reason || null,
    });
    notifyUser({
      userId: req.params.userId,
      kind: 'group_ban',
      title: 'Groupe',
      body: "Vous avez ete exclu d'un groupe.",
      voiceKey: 'member_banned',
      payload: { groupId: req.params.id },
    }).catch(() => {});
    res.json({ ...result, voiceKey: 'member_banned' });
  }),
);

router.delete(
  '/groups/:id/members/:userId/ban',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await unbanMember({
      groupId: req.params.id,
      memberId: req.params.userId,
      adminId: req.user.id,
    });
    res.json({ ...result, voiceKey: 'unblocked' });
  }),
);

/** Moderation : supprimer une publication du groupe. */
router.delete(
  '/groups/:id/ads/:adId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ad = await one('SELECT id, group_id, owner_id FROM ads WHERE id = $1', [req.params.adId]);
    if (!ad) throw notFound('ad_not_found', 'Annonce introuvable');
    const groupAdmin = await isGroupAdmin(req.params.id, req.user.id);
    if (!groupAdmin && ad.owner_id !== req.user.id && !req.user.is_admin) {
      throw forbidden('not_allowed', "Vous n'etes pas autorise a supprimer cette publication");
    }
    await updateAdStatus({
      adId: ad.id,
      actorId: req.user.id,
      isAdmin: Boolean(req.user.is_admin),
      isGroupAdminOf: groupAdmin,
      status: 'deleted',
      moderationNote: 'Supprimee par la moderation du groupe',
    });
    const recipients = await activeMemberIds(req.params.id);
    for (const userId of recipients.slice(0, 50)) {
      notifyUser({
        userId,
        kind: 'group_post_removed',
        title: 'Groupe',
        body: "Une publication a ete supprimee par l'administrateur.",
        voiceKey: 'post_deleted',
        payload: { groupId: req.params.id },
      }).catch(() => {});
    }
    res.json({ deleted: true, voiceKey: 'post_deleted' });
  }),
);

/** Fil de discussion du groupe : messages vocaux et textuels (cadre WhatsApp). */
router.get(
  '/groups/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const group = await getGroup(req.params.id, req.user.id);
    const isMember = await isActiveMember(req.params.id, req.user.id);
    const admin = await isGroupAdmin(req.params.id, req.user.id);
    if (!isMember && !admin) throw forbidden('not_group_member', 'Reserve aux membres du groupe');

    const { limit, offset } = readPage(req.query);
    const blockedIds = req.blockedIds || [];
    const params = [req.params.id, limit, offset];
    let blockClause = '';
    if (blockedIds.length) {
      params.push(blockedIds);
      blockClause = `AND m.sender_id <> ALL($${params.length}::uuid[])`;
    }

    const items = await many(
      `SELECT m.id, m.group_id, m.sender_id, m.kind, m.audio_key, m.audio_seconds,
              m.transcript, m.body, m.created_at,
              m.file_key, m.thumb_key, m.file_name, m.file_mime, m.file_bytes,
              u.name AS sender_name, u.phone AS sender_phone, u.avatar_key AS sender_avatar_key
       FROM group_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = $1 ${blockClause}
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      params,
    );

    res.json({
      group: { id: group.id, name: group.name, members_count: group.members_count },
      items,
      page: { limit, offset, count: items.length },
    });
  }),
);

/**
 * Envoyer un message dans le groupe.
 *  - JSON        : message texte
 *  - multipart   : vocal (champ `audio`), photo (champ `photo`) ou document (champ `file`)
 * Les membres sont notifies par push (pas de SMS : le cout serait vite eleve).
 */
router.post(
  '/groups/:id/messages',
  requireAuth,
  limiters.write(),
  uploadChatMedia,
  asyncHandler(async (req, res) => {
    const field = req.file?.fieldname || null;
    const parsed = z
      .object({
        body: z.string().max(1000).optional().nullable(),
        transcript: z.string().max(2000).optional().nullable(),
        seconds: z.coerce.number().int().min(1).max(60).optional().nullable(),
      })
      .safeParse(req.body || {});
    if (!parsed.success) throw badRequest('validation_error', 'Message invalide');
    const payload = parsed.data;

    const group = await getGroup(req.params.id, req.user.id);
    const isMember = await isActiveMember(req.params.id, req.user.id);
    const admin = await isGroupAdmin(req.params.id, req.user.id);
    if (!isMember && !admin) throw forbidden('not_group_member', 'Rejoignez le groupe pour ecrire');

    /** Inventaire du media (quota, nettoyage des orphelins). */
    const registerAsset = async ({ assetKind, key, bytes, mime, seconds = null }) =>
      query(
        `INSERT INTO media_assets (owner_id, kind, storage_key, mime_type, size_bytes, seconds, group_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (storage_key) DO NOTHING`,
        [req.user.id, assetKind, key, mime, bytes, seconds, group.id],
      );

    let message = null;
    let preview = '';

    if (field === 'audio') {
      assertAudioSize(req.file.buffer);
      const detected = detectAudio(req.file.buffer);
      const seconds = payload.seconds || estimateAudioSeconds(req.file.buffer.length);
      if (seconds > 60) {
        throw badRequest('audio_too_long', 'Maximum 60 secondes', { voiceKey: 'error_audio_too_long' });
      }
      const key = buildKey({ kind: 'audio/groups', ownerId: req.user.id, ext: detected.ext, groupId: group.id });
      await putObject({ key, body: req.file.buffer, contentType: detected.mime });
      await registerAsset({
        assetKind: 'audio',
        key,
        bytes: req.file.buffer.length,
        mime: detected.mime,
        seconds,
      });
      message = await one(
        `INSERT INTO group_messages (group_id, sender_id, kind, audio_key, audio_seconds, transcript, body)
         VALUES ($1, $2, 'voice', $3, $4, $5, NULL) RETURNING *`,
        [group.id, req.user.id, key, seconds, payload.transcript || null],
      );
      preview = payload.transcript ? `🎙️ ${payload.transcript}` : '🎙️ Message vocal';
    } else if (field === 'photo') {
      if (!req.file.buffer?.length) throw badRequest('photo_missing', 'Aucune photo recue');
      // Meme traitement que les photos d'annonces : WebP < 100 Ko + vignette
      const processed = await processPhoto(req.file.buffer);
      const key = buildKey({ kind: 'photos/groups', ownerId: req.user.id, ext: processed.main.ext, groupId: group.id });
      await putObject({ key, body: processed.main.buffer, contentType: processed.main.mime });
      let thumbKey = null;
      if (processed.thumb) {
        thumbKey = buildKey({ kind: 'thumbs/groups', ownerId: req.user.id, ext: processed.thumb.ext, groupId: group.id });
        await putObject({ key: thumbKey, body: processed.thumb.buffer, contentType: processed.thumb.mime });
      }
      await registerAsset({
        assetKind: 'photo',
        key,
        bytes: processed.main.size,
        mime: processed.main.mime,
      });
      message = await one(
        `INSERT INTO group_messages (group_id, sender_id, kind, file_key, thumb_key, file_mime, file_bytes, body)
         VALUES ($1, $2, 'image', $3, $4, $5, $6, $7) RETURNING *`,
        [group.id, req.user.id, key, thumbKey, processed.main.mime, processed.main.size, payload.body || null],
      );
      preview = '📷 Photo';
    } else if (field === 'file') {
      assertFileSize(req.file.buffer, env.MAX_FILE_BYTES);
      const name = safeFileName(req.file.originalname);
      const detected = detectDocument(name);
      const key = buildKey({ kind: 'files/groups', ownerId: req.user.id, ext: detected.ext, groupId: group.id });
      await putObject({ key, body: req.file.buffer, contentType: detected.mime });
      await registerAsset({ assetKind: 'file', key, bytes: req.file.buffer.length, mime: detected.mime });
      message = await one(
        `INSERT INTO group_messages (group_id, sender_id, kind, file_key, file_name, file_mime, file_bytes, body)
         VALUES ($1, $2, 'file', $3, $4, $5, $6, $7) RETURNING *`,
        [group.id, req.user.id, key, name, detected.mime, req.file.buffer.length, payload.body || null],
      );
      preview = `📄 ${name}`;
    } else {
      // Message texte
      const body = (payload.body || '').trim();
      if (!body) throw badRequest('body_required', 'Message vide');
      message = await one(
        `INSERT INTO group_messages (group_id, sender_id, kind, body)
         VALUES ($1, $2, 'text', $3) RETURNING *`,
        [group.id, req.user.id, body],
      );
      preview = body.slice(0, 90);
    }

    const recipients = await activeMemberIds(group.id, req.user.id);
    for (const userId of recipients.slice(0, 200)) {
      notifyUser({
        userId,
        kind: 'group_message',
        title: group.name,
        body: preview.slice(0, 120),
        voiceKey: 'new_message',
        payload: { groupId: group.id, messageId: message.id },
      }).catch(() => {});
    }

    res.status(201).json({ message, voiceKey: 'interest_sent' });
  }),
);

export default router;