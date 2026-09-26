import env from '../config/env.js';
import logger from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

/**
 * Traitement des medias pour une economie de donnees extreme :
 *  - photos : WebP, largeur max 1080 px, cible < 100 Ko (+ vignette 360 px)
 *  - audio  : Opus 24 kbps, max 60 s, cible < 50 Ko pour 30 s
 *
 * sharp est importe dynamiquement : si le binaire natif est indisponible,
 * l'API continue de fonctionner en renvoyant l'image d'origine.
 */
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch (err) {
  logger.warn({ err: err.message }, 'sharp indisponible : les photos seront stockees sans recompression');
}

export function imagePipelineAvailable() {
  return Boolean(sharp);
}

/** Compresse une photo en WebP en baissant progressivement la qualite. */
export async function processPhoto(input) {
  if (!sharp) {
    return {
      main: { buffer: input, width: null, height: null, size: input.length, mime: 'image/jpeg', ext: 'jpg' },
      thumb: null,
      optimized: false,
    };
  }

  const base = sharp(input, { failOn: 'none' }).rotate();
  const meta = await base.metadata();
  const width = Math.min(meta.width || env.IMAGE_MAX_WIDTH, env.IMAGE_MAX_WIDTH);

  let quality = env.IMAGE_WEBP_QUALITY;
  let buffer = await base.clone().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
  while (buffer.length > env.IMAGE_TARGET_BYTES && quality > 28) {
    quality -= 8;
    buffer = await base.clone().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
  }

  let thumb = null;
  try {
    const thumbBuffer = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize({ width: 360, withoutEnlargement: true })
      .webp({ quality: 50 })
      .toBuffer();
    thumb = { buffer: thumbBuffer, size: thumbBuffer.length, width: 360, mime: 'image/webp', ext: 'webp' };
  } catch (err) {
    logger.warn({ err: err.message }, 'Generation de vignette ignoree');
  }

  const outMeta = await sharp(buffer).metadata();
  return {
    main: {
      buffer,
      width: outMeta.width || width,
      height: outMeta.height || null,
      size: buffer.length,
      mime: 'image/webp',
      ext: 'webp',
    },
    thumb,
    optimized: true,
    quality,
  };
}

const AUDIO_SIGNATURES = [
  { ext: 'ogg', mime: 'audio/ogg', test: (b) => b.subarray(0, 4).toString('ascii') === 'OggS' },
  { ext: 'webm', mime: 'audio/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { ext: 'm4a', mime: 'audio/mp4', test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
];

/**
 * Verifie qu'un flux audio est bien un conteneur supporte (Opus en priorite).
 * @returns {{ ext: string, mime: string }}
 */
export function detectAudio(buffer) {
  if (!buffer || buffer.length < 12) {
    throw new AppError(400, 'audio_too_small', 'Message vocal vide', { voiceKey: 'error_audio_empty' });
  }
  const found = AUDIO_SIGNATURES.find((s) => s.test(buffer));
  if (!found) {
    throw new AppError(400, 'audio_format_unsupported', 'Format audio non supporte (Opus/Ogg attendu)', {
      voiceKey: 'error_audio_format',
    });
  }
  return { ext: found.ext, mime: found.mime };
}

export function assertAudioSize(buffer) {
  if (buffer.length > env.MAX_AUDIO_BYTES) {
    throw new AppError(413, 'audio_too_large', 'Message vocal trop long', { voiceKey: 'error_audio_too_long' });
  }
}

export function assertPhotoCount(count) {
  if (count > env.MAX_PHOTOS_PER_AD) {
    throw new AppError(400, 'too_many_photos', `Maximum ${env.MAX_PHOTOS_PER_AD} photos par annonce`, {
      voiceKey: 'error_too_many_photos',
    });
  }
}

/** Estimation de duree Opus a 24 kbps quand le client ne la fournit pas. */
export function estimateAudioSeconds(bytes, bitrateKbps = 24) {
  return Math.max(1, Math.round((bytes * 8) / (bitrateKbps * 1000)));
}

/**
 * Documents partages dans une discussion (facture, recu, liste, archive...).
 * Liste blanche volontairement stricte : aucun fichier executable.
 */
const DOCUMENTS = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

export function documentExtension(name = '') {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match ? match[1] : '';
}

/** @returns {{ext: string, mime: string}} ou leve une erreur explicite. */
export function detectDocument(name) {
  const ext = documentExtension(name);
  const mime = DOCUMENTS[ext];
  if (!mime) {
    throw new AppError(400, 'file_type_not_allowed', 'Type de fichier non autorise', {
      voiceKey: 'error_file_type',
    });
  }
  return { ext, mime };
}

export function assertFileSize(buffer, maxBytes) {
  if (!buffer?.length) throw new AppError(400, 'file_empty', 'Fichier vide', { voiceKey: 'error_file_empty' });
  if (buffer.length > maxBytes) {
    throw new AppError(413, 'file_too_large', 'Fichier trop volumineux', { voiceKey: 'error_file_too_large' });
  }
}

/** Nom de fichier sur : evite les injections de chemin et les noms trop longs. */
export function safeFileName(name = 'fichier') {
  const base = String(name)
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[^\p{L}\p{N}._ -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || 'fichier').slice(0, 120);
}

export default {
  processPhoto,
  detectAudio,
  detectDocument,
  assertAudioSize,
  assertPhotoCount,
  assertFileSize,
  safeFileName,
  documentExtension,
  estimateAudioSeconds,
};
