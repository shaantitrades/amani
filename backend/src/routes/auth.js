import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { requestOtp, verifyOtpCode } from '../services/otp.js';
import { issueSession, revokeAllTokens, rotateRefreshToken } from '../services/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { limiters } from '../middleware/rateLimit.js';
import { isSupportedLanguage } from '../services/voice.js';
import { one } from '../lib/db.js';
import { publicUser } from '../lib/serialize.js';

const router = Router();

const phoneField = z.string().min(6).max(24);

const requestSchema = z.object({
  phone: phoneField,
  language: z.string().length(2).optional().default('fr'),
});

const verifySchema = z.object({
  phone: phoneField,
  code: z.string().min(4).max(8),
  language: z.string().length(2).optional().default('fr'),
  name: z.string().max(80).optional(),
  district_id: z.string().uuid().optional(),
  city: z.string().max(80).optional(),
});

/**
 * Etape 1 : demande de code SMS.
 * Reponse : { sent, ttlSeconds, devCode? }
 */
router.post(
  '/request-code',
  limiters.otpRequest(),
  validateBody(requestSchema, { voiceKey: 'error_phone_invalid', message: 'Numero de telephone invalide' }),
  asyncHandler(async (req, res) => {
    const normalized = normalizePhone(req.body.phone);
    if (!normalized.ok) {
      throw badRequest('phone_invalid', 'Numero de telephone invalide', { voiceKey: 'error_phone_invalid' });
    }
    const language = isSupportedLanguage(req.body.language) ? req.body.language : 'fr';
    const result = await requestOtp({
      phone: normalized.e164,
      ip: req.ip,
      language,
      purpose: 'login',
    });
    res.json({
      phone: normalized.e164,
      sent: result.sent,
      ttlSeconds: result.ttlSeconds,
      devCode: result.devCode,
    });
  }),
);

/**
 * Etape 2 : verification du code -> creation implicite du compte si nouveau.
 * Reponse : { user, tokens: { accessToken, refreshToken }, isNewUser }
 */
router.post(
  '/verify',
  limiters.otpRequest(),
  validateBody(verifySchema, { voiceKey: 'error_code_invalid', message: 'Code invalide' }),
  asyncHandler(async (req, res) => {
    const normalized = normalizePhone(req.body.phone);
    if (!normalized.ok) {
      throw badRequest('phone_invalid', 'Numero de telephone invalide', { voiceKey: 'error_phone_invalid' });
    }
    const language = isSupportedLanguage(req.body.language) ? req.body.language : 'fr';
    const { user, isNewUser } = await verifyOtpCode({
      phone: normalized.e164,
      code: req.body.code.trim(),
      language,
    });

    // Premiers reglages transmis en meme temps que l'inscription.
    if (isNewUser && (req.body.name || req.body.district_id || req.body.city)) {
      await one(
        `UPDATE users SET name = COALESCE($2, name), district_id = COALESCE($3, district_id),
                          city = COALESCE($4, city) WHERE id = $1`,
        [user.id, req.body.name || null, req.body.district_id || null, req.body.city || null],
      );
    }

    const tokens = await issueSession(user, req.headers['user-agent']);
    const fresh = await one('SELECT * FROM users WHERE id = $1', [user.id]);
    res.json({
      user: publicUser(fresh),
      tokens,
      isNewUser,
      // Message vocal a jouer cote client
      voiceKey: isNewUser ? 'welcome' : 'synced',
    });
  }),
);

/** Renouvellement de session (rotation : l'ancien jeton est revoque). */
router.post(
  '/refresh',
  validateBody(z.object({ refreshToken: z.string().min(20) })),
  asyncHandler(async (req, res) => {
    const result = await rotateRefreshToken(req.body.refreshToken, req.headers['user-agent']);
    res.json({ user: publicUser(result.user), tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken } });
  }),
);

/** Deconnexion : revoque toutes les sessions de l'utilisateur. */
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllTokens(req.user.id);
    res.json({ ok: true });
  }),
);

export default router;
