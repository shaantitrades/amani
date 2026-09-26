import { putObject, buildKey } from '../services/storage.js';
import logger from '../lib/logger.js';

/**
 * Fabbrication des medias de demonstration (jeu de donnees de test).
 *
 *  - Photos : SVG -> WebP via sharp (poids < 100 Ko), donc de vrais fichiers
 *    affichables, sans dependance externe ni telechargement.
 *  - Audio  : WAV PCM 16 bits mono genere par calcul (sons + silence). Les vrais
 *    enregistrements de l'application sont en Opus ; le WAV est utilise ici
 *    uniquement parce qu'il est lisible par tous les navigateurs de test
 *    sans encodeur natif.
 */

let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  logger.warn('sharp indisponible : les photos de demonstration ne seront pas generees');
}

const PALETTE = ['#075E54', '#25D366', '#34B7F1', '#128C7E', '#ECE5DD', '#5B4A3F', '#C0392B'];

/** Photo de demonstration : degrade + icone + libelle en gros (style annonce). */
export async function makePlaceholderPhoto({ label, icon = '📦', seed = 0, width = 900, height = 675 }) {
  if (!sharp) return null;
  const bg = PALETTE[seed % PALETTE.length];
  const bg2 = PALETTE[(seed + 3) % PALETTE.length];
  const safeLabel = String(label || '').replace(/[<>&]/g, '').slice(0, 28);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <circle cx="${width / 2}" cy="${height * 0.4}" r="${height * 0.22}" fill="#ffffff" opacity="0.18"/>
    <text x="50%" y="${height * 0.45}" font-size="${height * 0.26}" text-anchor="middle" dominant-baseline="middle">${icon}</text>
    <text x="50%" y="${height * 0.78}" font-size="${height * 0.11}" fill="#ffffff"
          font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" text-anchor="middle">${safeLabel}</text>
  </svg>`;

  const buffer = await sharp(Buffer.from(svg)).webp({ quality: 68 }).toBuffer();
  const thumb = await sharp(Buffer.from(svg)).resize({ width: 360 }).webp({ quality: 50 }).toBuffer();
  return { buffer, thumb, size: buffer.length };
}

/** Genere un WAV PCM mono 16 bits (message vocal de demonstration). */
export function makeToneWav({ seconds = 4, sampleRate = 16000, kind = 'voice' } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    let value = 0;
    if (kind === 'voice') {
      // Simule un rythme de parole : porteuse modulee par des enveloppes lentes
      const envelope = Math.max(0, Math.sin(2 * Math.PI * 1.7 * t)) * Math.max(0, Math.sin(2 * Math.PI * 0.35 * t));
      value = Math.sin(2 * Math.PI * 220 * t) * 0.35 * envelope + Math.sin(2 * Math.PI * 440 * t) * 0.12 * envelope;
    } else {
      value = Math.sin(2 * Math.PI * 660 * t) * 0.25;
    }
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // taille du bloc fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits par echantillon
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);

  return { buffer: Buffer.concat([header, data]), seconds };
}

/** Envoie les medias de demonstration vers le stockage configure. */
export async function storeDemoMedia({ label, icon, seed, ownerId, scope = 'seed' }) {
  const photo = await makePlaceholderPhoto({ label, icon, seed });
  if (!photo) return null;

  const key = buildKey({ kind: `photos/${scope}`, ownerId, ext: 'webp' });
  const thumbKey = buildKey({ kind: `thumbs/${scope}`, ownerId, ext: 'webp' });
  await putObject({ key, body: photo.buffer, contentType: 'image/webp' });
  await putObject({ key: thumbKey, body: photo.thumb, contentType: 'image/webp' });

  const audio = makeToneWav({ seconds: 3 + (seed % 3) });
  const audioKey = buildKey({ kind: `audio/ads/${scope}`, ownerId, ext: 'wav' });
  await putObject({ key: audioKey, body: audio.buffer, contentType: 'audio/wav' });

  return {
    photo: { storage_key: key, thumb_key: thumbKey, width: 900, height: 675, size_bytes: photo.size },
    audio: { key: audioKey, seconds: audio.seconds, size: audio.buffer.length },
  };
}

export default { makePlaceholderPhoto, makeToneWav, storeDemoMedia };
