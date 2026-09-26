import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAudioSize, assertPhotoCount, detectAudio, estimateAudioSeconds } from '../src/services/media.js';
import { AppError } from '../src/lib/errors.js';
import { buildKey, contentTypeFor, sanitizeKey } from '../src/services/storage.js';

function oggBuffer(size = 64) {
  const buf = Buffer.alloc(size);
  buf.write('OggS', 0, 'ascii');
  return buf;
}

function webmBuffer(size = 64) {
  const buf = Buffer.alloc(size);
  buf.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return buf;
}

test('detecte un conteneur Ogg (Opus/Discord des navigateurs Firefox)', () => {
  assert.deepEqual(detectAudio(oggBuffer()), { ext: 'ogg', mime: 'audio/ogg' });
});

test('detecte un conteneur WebM (Chrome/Android)', () => {
  assert.deepEqual(detectAudio(webmBuffer()), { ext: 'webm', mime: 'audio/webm' });
});

test('detecte un conteneur MP4/M4A (Safari, iOS)', () => {
  const buf = Buffer.alloc(64);
  buf.write('ftyp', 4, 'ascii');
  assert.deepEqual(detectAudio(buf), { ext: 'm4a', mime: 'audio/mp4' });
});

test('rejette un audio vide ou d\'un format inconnu', () => {
  assert.throws(() => detectAudio(Buffer.alloc(4)), AppError);
  assert.throws(() => detectAudio(Buffer.from('ceci nest pas de l audio du tout')), /Format audio non supporte/);
});

test('limite la taille des messages vocaux (1 Mo par defaut)', () => {
  assert.doesNotThrow(() => assertAudioSize(Buffer.alloc(1024)));
  assert.throws(() => assertAudioSize(Buffer.alloc(2 * 1024 * 1024)), /trop long/);
});

test('limite le nombre de photos par annonce a 6', () => {
  assert.doesNotThrow(() => assertPhotoCount(6));
  assert.throws(() => assertPhotoCount(7), /Maximum 6 photos/);
});

test('estime la duree Opus a 24 kbps', () => {
  // 24 kbps pendant 30 s = 90 000 octets
  assert.equal(estimateAudioSeconds(90000, 24), 30);
  assert.equal(estimateAudioSeconds(100, 24), 1);
});

test('buildKey range les medias par type, proprietaire et mois', () => {
  const key = buildKey({ kind: 'photos', ownerId: 'user-1', ext: 'webp' });
  assert.match(key, /^photos\/users\/user-1\/\d{6}\/[\w-]+\.webp$/);
  const audio = buildKey({ kind: 'audio/ads', ownerId: 'user-1', ext: 'ogg' });
  assert.match(audio, /^audio\/ads\/users\/user-1\//);
});

test('sanitizeKey bloque les remontees de repertoire', () => {
  assert.equal(sanitizeKey('/photos/../../etc/passwd'), 'photos/etc/passwd');
  assert.equal(sanitizeKey('a//b'), 'a/b');
  assert.throws(() => sanitizeKey(''), AppError);
});

test('contentTypeFor couvre les formats utilises', () => {
  assert.equal(contentTypeFor('a/b.webp'), 'image/webp');
  assert.equal(contentTypeFor('a/b.ogg'), 'audio/ogg');
  assert.equal(contentTypeFor('a/b.webm'), 'audio/webm');
  assert.equal(contentTypeFor('a/b.unknown'), 'application/octet-stream');
});
