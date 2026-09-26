import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import env from '../config/env.js';
import logger from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

/**
 * Stockage des medias : pilotable par variables d'environnement.
 *  - local : disque (developpement, tests)
 *  - minio : S3 compatible auto-heberge sur le VPS (developpement/staging)
 *  - b2    : Backblaze B2 en production, Cloudflare CDN devant
 *
 * Les fichiers ne sont jamais exposes directement : ils sont relus via
 * GET /media/<key> (proxy backend) ce qui permet les URLs stables, le cache CDN
 * et le controle d'acces (blocages, annonces supprimees).
 */

let s3 = null;
let s3mod = null;

async function getS3() {
  if (s3) return s3;
  if (!s3mod) s3mod = await import('@aws-sdk/client-s3');
  const { S3Client } = s3mod;
  s3 = new S3Client({
    region: env.storage.region,
    endpoint: env.storage.endpoint,
    forcePathStyle: env.storage.driver === 'minio',
    credentials: {
      accessKeyId: env.storage.accessKeyId,
      secretAccessKey: env.storage.secretAccessKey,
    },
  });
  return s3;
}

/** Empeche toute remontee de repertoire et normalise la cle. */
export function sanitizeKey(key) {
  const clean = String(key || '')
    .replace(/\\/g, '/')
    .replace(/\.\.+/g, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
  if (!clean || clean.includes('\0')) throw new AppError(400, 'bad_key', 'Cle de stockage invalide');
  return clean;
}

export function buildKey({ kind, ownerId, ext = 'webp', groupId = null }) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 10);
  const scope = groupId ? `groups/${groupId}` : `users/${ownerId || 'anon'}`;
  return `${kind}/${scope}/${yyyy}${mm}/${Date.now()}-${rand}.${ext}`;
}

export async function putObject({ key, body, contentType }) {
  const safe = sanitizeKey(key);
  if (env.storage.driver === 'local') {
    const full = path.join(path.resolve(env.STORAGE_LOCAL_DIR), safe);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    return { key: safe, size: body.length, driver: 'local' };
  }
  const client = await getS3();
  const { PutObjectCommand } = s3mod;
  await client.send(
    new PutObjectCommand({
      Bucket: env.storage.bucket,
      Key: safe,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return { key: safe, size: body.length, driver: env.storage.driver };
}

export async function deleteObject(key) {
  const safe = sanitizeKey(key);
  if (env.storage.driver === 'local') {
    await fs.rm(path.join(path.resolve(env.STORAGE_LOCAL_DIR), safe), { force: true });
    return true;
  }
  const client = await getS3();
  const { DeleteObjectCommand } = s3mod;
  await client.send(new DeleteObjectCommand({ Bucket: env.storage.bucket, Key: safe }));
  return true;
}

/** Retourne { stream, contentType, size } ou null si absent. */
export async function getObject(key) {
  const safe = sanitizeKey(key);
  if (env.storage.driver === 'local') {
    const full = path.join(path.resolve(env.STORAGE_LOCAL_DIR), safe);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) return null;
      return {
        stream: createReadStream(full),
        size: stat.size,
        contentType: contentTypeFor(safe),
        mtime: stat.mtime,
      };
    } catch {
      return null;
    }
  }
  const client = await getS3();
  const { GetObjectCommand } = s3mod;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: env.storage.bucket, Key: safe }));
    if (!res.Body) return null;
    return {
      stream: res.Body instanceof Readable ? res.Body : Readable.from(res.Body),
      size: res.ContentLength,
      contentType: res.ContentType || contentTypeFor(safe),
    };
  } catch (err) {
    if (['NoSuchKey', 'NotFound', '404'].includes(err?.name) || err?.$metadata?.httpStatusCode === 404) return null;
    logger.error({ err: err.message, key: safe }, 'Lecture objet impossible');
    throw new AppError(502, 'storage_error', 'Media indisponible');
  }
}

export async function objectExists(key) {
  const obj = await getObject(key).catch(() => null);
  if (!obj) return false;
  obj.stream?.destroy?.();
  return true;
}

export function contentTypeFor(key) {
  const ext = path.extname(key).toLowerCase();
  return (
    {
      '.webp': 'image/webp',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.opus': 'audio/ogg',
      '.ogg': 'audio/ogg',
      '.webm': 'audio/webm',
      '.m4a': 'audio/mp4',
      '.mp4': 'audio/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
    }[ext] || 'application/octet-stream'
  );
}

export function storageHealth() {
  return { driver: env.storage.driver, bucket: env.storage.bucket, endpoint: env.storage.endpoint || 'local' };
}

export default { putObject, getObject, deleteObject, sanitizeKey, buildKey, contentTypeFor, storageHealth };
