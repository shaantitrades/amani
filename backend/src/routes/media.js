import { Router } from 'express';
import { one } from '../lib/db.js';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadPhoto, uploadAudio, uploadAvatar, uploadCover } from '../middleware/upload.js';
import { limiters } from '../middleware/rateLimit.js';
import { processPhoto, detectAudio, assertAudioSize, estimateAudioSeconds } from '../services/media.js';
import { putObject, buildKey } from '../services/storage.js';
import { transcribe, sttEnabled } from '../services/stt.js';

const router = Router();

async function registerAsset({ ownerId, kind, key, mime, size, seconds = null, extra = {} }) {
  return one(
    `INSERT INTO media_assets (owner_id, kind, storage_key, mime_type, size_bytes, seconds, ad_id, group_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (storage_key) DO UPDATE SET size_bytes = EXCLUDED.size_bytes
     RETURNING id, storage_key`,
    [ownerId, kind, key, mime, size, seconds, extra.adId || null, extra.groupId || null],
  );
}

/**
 * Photo d'annonce : recompressee en WebP (< 100 Ko) + vignette 360 px.
 * Maximum 6 photos par annonce (compteur 3/6 affiche cote client).
 */
router.post(
  '/media/photo',
  requireAuth,
  limiters.media(),
  uploadPhoto,
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer?.length) {
      throw badRequest('photo_missing', 'Aucune photo recue', { voiceKey: 'error_generic' });
    }

    const processed = await processPhoto(req.file.buffer);
    const key = buildKey({ kind: 'photos', ownerId: req.user.id, ext: processed.main.ext });
    await putObject({ key, body: processed.main.buffer, contentType: processed.main.mime });

    let thumbKey = null;
    if (processed.thumb) {
      thumbKey = buildKey({ kind: 'thumbs', ownerId: req.user.id, ext: processed.thumb.ext });
      await putObject({ key: thumbKey, body: processed.thumb.buffer, contentType: processed.thumb.mime });
    }

    await registerAsset({
      ownerId: req.user.id,
      kind: 'photo',
      key,
      mime: processed.main.mime,
      size: processed.main.size,
      extra: { adId: req.body?.ad_id || null },
    });

    res.status(201).json({
      key,
      thumb_key: thumbKey,
      width: processed.main.width,
      height: processed.main.height,
      size_bytes: processed.main.size,
      optimized: processed.optimized,
      voiceKey: 'photo_added',
    });
  }),
);

/**
 * Message vocal (Opus, 60 s max). Enregistre le fichier et, si le module
 * Speech-to-Text est active, renvoie la transcription (recherche vocale).
 */
router.post(
  '/media/audio',
  requireAuth,
  limiters.media(),
  uploadAudio,
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer?.length) {
      throw badRequest('audio_missing', 'Aucun audio recu', { voiceKey: 'error_audio_empty' });
    }
    assertAudioSize(req.file.buffer);
    const { ext, mime } = detectAudio(req.file.buffer);

    const seconds = Number(req.body?.seconds) || estimateAudioSeconds(req.file.buffer.length);
    if (seconds > 60) {
      throw badRequest('audio_too_long', 'Maximum 60 secondes', { voiceKey: 'error_audio_too_long' });
    }

    const scope = req.body?.scope === 'message' ? 'messages' : req.body?.scope === 'rating' ? 'ratings' : 'ads';
    const key = buildKey({ kind: `audio/${scope}`, ownerId: req.user.id, ext });
    await putObject({ key, body: req.file.buffer, contentType: mime });
    await registerAsset({ ownerId: req.user.id, kind: 'audio', key, mime, size: req.file.buffer.length, seconds });

    let transcript = null;
    if (sttEnabled() && req.body?.transcribe !== 'false') {
      transcript = await transcribe(req.file.buffer, { mimeType: mime, language: req.user.language || 'fr' });
    }

    res.status(201).json({
      key,
      mime,
      seconds,
      size_bytes: req.file.buffer.length,
      transcript,
      voiceKey: 'recording_stop',
    });
  }),
);

/** Photo de profil (optionnelle). */
router.post(
  '/media/avatar',
  requireAuth,
  limiters.media(),
  uploadAvatar,
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer?.length) throw badRequest('photo_missing', 'Aucune photo recue');
    const processed = await processPhoto(req.file.buffer);
    const key = buildKey({ kind: 'avatars', ownerId: req.user.id, ext: processed.main.ext });
    await putObject({ key, body: processed.main.buffer, contentType: processed.main.mime });
    await registerAsset({
      ownerId: req.user.id,
      kind: 'avatar',
      key,
      mime: processed.main.mime,
      size: processed.main.size,
    });
    await one('UPDATE users SET avatar_key = $2 WHERE id = $1', [req.user.id, key]);
    res.status(201).json({ key, voiceKey: 'photo_added' });
  }),
);

/** Photo de couverture d'un groupe. */
router.post(
  '/media/cover',
  requireAuth,
  limiters.media(),
  uploadCover,
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer?.length) throw badRequest('photo_missing', 'Aucune photo recue');
    const processed = await processPhoto(req.file.buffer);
    const key = buildKey({ kind: 'covers', ownerId: req.user.id, ext: processed.main.ext });
    await putObject({ key, body: processed.main.buffer, contentType: processed.main.mime });
    await registerAsset({
      ownerId: req.user.id,
      kind: 'cover',
      key,
      mime: processed.main.mime,
      size: processed.main.size,
      extra: { groupId: req.body?.group_id || null },
    });
    res.status(201).json({ key, voiceKey: 'photo_added' });
  }),
);

/** Quota de stockage personnel (transparence et economie de donnees). */
router.get(
  '/media/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await one(
      `SELECT count(*)::int AS files, coalesce(sum(size_bytes), 0)::bigint AS bytes
       FROM media_assets WHERE owner_id = $1`,
      [req.user.id],
    );
    res.json({ storage: row });
  }),
);

export default router;