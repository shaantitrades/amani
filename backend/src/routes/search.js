import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { uploadAudio } from '../middleware/upload.js';
import { limiters } from '../middleware/rateLimit.js';
import { readPage } from '../lib/pagination.js';
import { listAdFeed } from '../services/ads.js';
import { transcribe, sttEnabled } from '../services/stt.js';
import { putObject, buildKey } from '../services/storage.js';
import { detectAudio, assertAudioSize } from '../services/media.js';
import { notifyUser } from '../services/notifications.js';

const router = Router();

/** Suggestions de categories (boutons visuels, zero texte obligatoire). */
export async function categorySuggestions(limit = 8) {
  return many(
    `SELECT c.id, c.code, c.label_fr, c.label_ar, c.label_ff, c.label_sar, c.icon, c.color,
            (SELECT count(*)::int FROM ads a WHERE a.category_id = c.id AND a.status = 'published') AS ads_count
     FROM categories c WHERE c.is_active
     ORDER BY ads_count DESC, c.sort_order ASC LIMIT $1`,
    [limit],
  );
}

/** Recherche texte (filtres par icones : categorie, quartier, prix, type). */
router.get(
  '/search',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset } = readPage(req.query);
    const q = req.query.q ? String(req.query.q).slice(0, 120) : null;
    const items = await listAdFeed({
      viewerId: req.user?.id || null,
      blockedIds: req.blockedIds || [],
      q,
      categoryId: req.query.category_id || null,
      districtId: req.query.district_id || null,
      kind: req.query.kind === 'sell' || req.query.kind === 'want' ? req.query.kind : null,
      minPrice: req.query.min_price !== undefined && req.query.min_price !== '' ? Number(req.query.min_price) : null,
      maxPrice: req.query.max_price !== undefined && req.query.max_price !== '' ? Number(req.query.max_price) : null,
      limit,
      offset,
    });

    // Aucun resultat -> on oriente vers les categories les plus actives
    const suggestions = items.length === 0 ? await categorySuggestions() : [];

    res.json({
      items,
      page: { limit, offset, count: items.length },
      query: q,
      sttEnabled: sttEnabled(),
      suggestions,
      voiceKey: items.length === 0 ? 'nothing_found' : 'synced',
    });
  }),
);

/**
 * Recherche vocale : "l'utilisateur dit ce qu'il cherche".
 *  - STT actif   : transcription puis recherche plein texte
 *  - STT inactif : retour des categories proches (orientation par icones)
 */
router.post(
  '/search/voice',
  requireAuth,
  limiters.media(),
  uploadAudio,
  asyncHandler(async (req, res) => {
    const buffer = req.file?.buffer;
    let transcript = null;
    let audioKey = null;

    if (buffer?.length) {
      assertAudioSize(buffer);
      const { ext, mime } = detectAudio(buffer);
      if (sttEnabled()) {
        transcript = await transcribe(buffer, { mimeType: mime, language: req.user.language || 'fr' });
      }
      audioKey = buildKey({ kind: 'audio/searches', ownerId: req.user.id, ext });
      await putObject({ key: audioKey, body: buffer, contentType: mime }).catch(() => {});
    }

    const { limit, offset } = readPage(req.query);
    const items = transcript
      ? await listAdFeed({
          viewerId: req.user.id,
          blockedIds: req.blockedIds || [],
          q: transcript,
          districtId: req.body?.district_id || null,
          limit,
          offset,
        })
      : [];

    const suggestions = transcript ? [] : await categorySuggestions();

    const log = await one(
      `INSERT INTO voice_searches (user_id, audio_key, transcript, language, results_count, district_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, audioKey, transcript, req.user.language || 'fr', items.length, req.body?.district_id || null],
    );

    res.json({
      id: log?.id,
      transcript,
      items,
      page: { limit, offset, count: items.length },
      suggestions,
      sttEnabled: sttEnabled(),
      voiceKey: transcript ? (items.length ? 'synced' : 'nothing_found') : 'voice_search_hint',
    });
  }),
);

/**
 * Alerte SMS : "prevenez-moi quand une annonce correspond a ma recherche".
 * Essentiel pour les utilisateurs connectes seulement quelques minutes par jour.
 */
router.post(
  '/search/alert',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        q: z.string().max(120).optional(),
        category_id: z.string().uuid().optional(),
        district_id: z.string().uuid().optional(),
      })
      .parse(req.body);

    await notifyUser({
      userId: req.user.id,
      kind: 'search_alert',
      smsTemplate: 'ad_interest',
      smsVars: { category: body.q || 'votre recherche' },
      title: 'Alerte activee',
      body: 'Vous serez prevenu des nouvelles annonces correspondantes.',
      voiceKey: 'search_alert_saved',
      payload: body,
    });
    res.status(201).json({ ok: true, voiceKey: 'search_alert_saved' });
  }),
);

/** Suggestions de categories (route publique). */
router.get(
  '/search/suggestions',
  asyncHandler(async (req, res) => {
    res.json({ items: await categorySuggestions() });
  }),
);

export default router;