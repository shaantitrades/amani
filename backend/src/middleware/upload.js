import multer from 'multer';
import env from '../config/env.js';
import { badRequest } from '../lib/errors.js';

/**
 * Upload en memoire : le fichier est traite (WebP / verification Opus) avant
 * d'etre pousse vers le stockage objet. Aucun fichier temporaire sur disque.
 */
const storage = multer.memoryStorage();

function build({ maxBytes, fieldName, code, message, voiceKey }) {
  return multer({
    storage,
    limits: { fileSize: maxBytes, files: 1, fields: 20 },
    fileFilter: (req, file, cb) => {
      if (file.fieldname !== fieldName) {
        return cb(badRequest('bad_field', `Champ de fichier attendu : ${fieldName}`));
      }
      return cb(null, true);
    },
  }).single(fieldName);
}

/** Photo d'annonce (max 5 Mo avant recompression WebP). */
export const uploadPhoto = (req, res, next) =>
  build({
    maxBytes: env.MAX_PHOTO_BYTES,
    fieldName: 'photo',
    code: 'photo_too_large',
    message: 'Photo trop volumineuse',
    voiceKey: 'error_generic',
  })(req, res, (err) => wrapMulterError(err, next, 'photo'));

/** Message vocal (Opus, max 1 Mo ~ 5 minutes theoriques, 60 s imposees cote client). */
export const uploadAudio = (req, res, next) =>
  build({
    maxBytes: env.MAX_AUDIO_BYTES,
    fieldName: 'audio',
    code: 'audio_too_large',
    message: 'Message vocal trop volumineux',
    voiceKey: 'error_audio_too_long',
  })(req, res, (err) => wrapMulterError(err, next, 'audio'));

export const uploadAvatar = (req, res, next) =>
  build({
    maxBytes: env.MAX_PHOTO_BYTES,
    fieldName: 'avatar',
    code: 'avatar_too_large',
    message: 'Photo trop volumineuse',
    voiceKey: 'error_generic',
  })(req, res, (err) => wrapMulterError(err, next, 'avatar'));

export const uploadCover = (req, res, next) =>
  build({
    maxBytes: env.MAX_PHOTO_BYTES,
    fieldName: 'cover',
    code: 'cover_too_large',
    message: 'Image trop volumineuse',
    voiceKey: 'error_generic',
  })(req, res, (err) => wrapMulterError(err, next, 'cover'));

function wrapMulterError(err, next, field) {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(
        badRequest(`${field}_too_large`, 'Fichier trop volumineux', {
          voiceKey:
            field === 'audio' ? 'error_audio_too_long' : field === 'file' ? 'error_file_too_large' : 'error_generic',
        }),
      );
    }
    return next(badRequest('upload_error', err.message, { voiceKey: 'error_generic' }));
  }
  return next(err);
}

/**
 * Pieces jointes d'une discussion de groupe : vocal (Opus), photo ou document.
 * Un seul fichier par message ; le nom du champ indique le type de message.
 */
const CHAT_FIELDS = ['audio', 'photo', 'file'];

const chatUploader = multer({
  storage,
  limits: {
    fileSize: Math.max(env.MAX_AUDIO_BYTES, env.MAX_PHOTO_BYTES, env.MAX_FILE_BYTES),
    files: 1,
    fields: 20,
  },
  fileFilter: (req, file, cb) => {
    if (!CHAT_FIELDS.includes(file.fieldname)) {
      return cb(badRequest('bad_field', `Champ de fichier inattendu : ${file.fieldname}`));
    }
    return cb(null, true);
  },
}).any();

export const uploadChatMedia = (req, res, next) =>
  chatUploader(req, res, (err) => {
    if (err) return wrapMulterError(err, next, 'file');
    // Normalisation : multer.any() remplit req.files, le handler lit req.file
    const [file] = req.files || [];
    if (file) req.file = file;
    return next();
  });

export default { uploadPhoto, uploadAudio, uploadAvatar, uploadCover, uploadChatMedia };
