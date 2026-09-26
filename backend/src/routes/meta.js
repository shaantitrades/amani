import { Router } from 'express';
import { many } from '../lib/db.js';
import { asyncHandler } from '../lib/errors.js';
import { LANGUAGES, manifest as voiceManifest } from '../services/voice.js';
import env from '../config/env.js';
import { sttEnabled } from '../services/stt.js';
import { COUNTRIES } from '../lib/phone.js';

const router = Router();

/**
 * Donnees de reference mises en cache par la PWA pour fonctionner hors ligne :
 * categories, quartiers, langues, devises, cles de messages vocaux.
 */
router.get(
  '/bootstrap',
  asyncHandler(async (req, res) => {
    const [categories, districts] = await Promise.all([
      many(`SELECT id, code, label_fr, label_ar, label_ff, label_sar, icon, color, sort_order
            FROM categories WHERE is_active ORDER BY sort_order ASC`),
      many(`SELECT id, name, name_ar, city, country, lat, lng, radius_km
            FROM districts WHERE is_active ORDER BY sort_order ASC, name ASC`),
    ]);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      app: { name: env.APP_NAME, web: env.PUBLIC_WEB_URL, api: env.PUBLIC_API_URL },
      languages: LANGUAGES,
      countries: COUNTRIES,
      currencies: [
        { code: 'XAF', label: 'FCFA', symbol: 'FCFA' },
        { code: 'USD', label: 'Dollar', symbol: '$' },
        { code: 'GOLD', label: 'Or', symbol: 'g' },
      ],
      adKinds: [
        { code: 'sell', label_fr: 'Je vends', label_ar: 'أبيع', color: '#25D366' },
        { code: 'want', label_fr: 'Je cherche', label_ar: 'أبحث', color: '#34B7F1' },
      ],
      features: {
        stt: sttEnabled(),
        push: true,
        offlineQueue: true,
        maxPhotos: env.MAX_PHOTOS_PER_AD,
        maxAudioSeconds: 60,
        minTouchSize: 60,
        // Cle publique VAPID pour l'abonnement push de la PWA (null si desactive)
        vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
      },
      categories,
      districts,
    });
  }),
);

/** Liste des categories (grille d'icones). */
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const rows = await many(
      `SELECT id, code, label_fr, label_ar, label_ff, label_sar, icon, color
       FROM categories WHERE is_active ORDER BY sort_order ASC`,
    );
    res.json({ items: rows });
  }),
);

/** Quartiers / villes (boutons de localisation simplifiee). */
router.get(
  '/districts',
  asyncHandler(async (req, res) => {
    const city = req.query.city ? String(req.query.city) : null;
    const rows = city
      ? await many(
          `SELECT id, name, name_ar, city, lat, lng, radius_km FROM districts
           WHERE is_active AND city = $1 ORDER BY sort_order ASC, name ASC`,
          [city],
        )
      : await many(
          `SELECT id, name, name_ar, city, lat, lng, radius_km FROM districts
           WHERE is_active ORDER BY city ASC, sort_order ASC`,
        );
    res.json({ items: rows });
  }),
);

/** Catalogue des messages vocaux (guide d'enregistrement + relecture PWA). */
router.get('/voice/manifest', (req, res) => {
  res.json({ generatedAt: new Date().toISOString(), languages: voiceManifest() });
});

export default router;
