import idb from './idb.js';
import { api, isOnline, mediaUrl } from './api.js';

/**
 * File d'attente de publication hors ligne.
 *
 * Scenario cible : l'utilisateur prepare son annonce (photos + vocal) sans
 * reseau. Les fichiers restent dans IndexedDB (Blobs) et sont envoyes des que
 * la connexion revient. `client_uuid` garantit l'absence de doublon cote serveur.
 */

const STORE = 'outbox';

export function newClientUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Repli pour les navigateurs anciens (Android 5 sans crypto.randomUUID)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * @param {object} draft
 * @param {string} draft.category_id
 * @param {'sell'|'want'} draft.kind
 * @param {Array<{blob: Blob, name: string}>} draft.photos
 * @param {{blob: Blob, seconds: number}|null} draft.audio
 * @param {object} draft.fields reste des champs de l'annonce
 */
export async function enqueueDraft(draft) {
  const entry = {
    id: newClientUuid(),
    client_uuid: newClientUuid(),
    created_at: Date.now(),
    status: 'pending',
    error: null,
    // Les cles de medias deja televersees evitent de renvoyer les fichiers
    uploaded: { photos: [], audio: null, photoKeys: [], thumbKeys: [] },
    ...draft,
  };
  await idb.put(STORE, entry);
  return entry;
}

export async function listDrafts() {
  const rows = await idb.all(STORE);
  return (rows || []).sort((a, b) => a.created_at - b.created_at);
}

export async function pendingCount() {
  try {
    const rows = await listDrafts();
    return rows.filter((r) => r.status !== 'synced').length;
  } catch {
    return 0;
  }
}

export async function removeDraft(id) {
  await idb.remove(STORE, id);
}

async function uploadPhoto(blob, name) {
  const form = new FormData();
  form.append('photo', blob, name || 'photo.webp');
  return api.upload('/media/photo', form);
}

async function uploadAudio(blob) {
  const form = new FormData();
  form.append('audio', blob, 'voice.webm');
  return api.upload('/media/audio', form);
}

/**
 * Envoie une entree de la file : medias puis annonce (idempotent).
 * @returns {Promise<{ad: object, entry: object}>}
 */
export async function syncDraft(entry) {
  // 1. Photos (une seule fois : on memorise les cles obtenues)
  const photoKeys = [...(entry.uploaded?.photoKeys || [])];
  const thumbKeys = [...(entry.uploaded?.thumbKeys || [])];
  const pendingPhotos = (entry.photos || []).slice(photoKeys.length);
  for (const photo of pendingPhotos) {
    const uploaded = await uploadPhoto(photo.blob, photo.name);
    photoKeys.push(uploaded.key);
    thumbKeys.push(uploaded.thumb_key || null);
    await idb.put(STORE, { ...entry, uploaded: { ...entry.uploaded, photoKeys, thumbKeys } });
  }

  // 2. Message vocal
  let audio = entry.uploaded?.audio || null;
  if (!audio && entry.audio?.blob) {
    audio = await uploadAudio(entry.audio.blob);
    await idb.put(STORE, { ...entry, uploaded: { ...entry.uploaded, photos: photoKeys, audio } });
  }

  // 3. Annonce (client_uuid = pas de doublon si l'envoi est rejoue)
  const payload = {
    ...entry.fields,
    category_id: entry.category_id,
    kind: entry.kind,
    client_uuid: entry.client_uuid,
    description_audio_key: audio?.key || null,
    description_audio_seconds: entry.audio?.seconds || audio?.seconds || null,
    photos: photoKeys.map((key, i) => ({
      storage_key: key,
      thumb_key: thumbKeys[i] || null,
      size_bytes: null,
    })),
  };
  const result = await api.post('/ads', payload);
  await idb.put(STORE, { ...entry, status: 'synced', error: null, serverAdId: result.ad?.id || null });
  return { ad: result.ad, duplicate: result.duplicate, entry };
}

/**
 * Synchronise toute la file. Appelee au retour de la connexion et a l'ouverture.
 * @returns {Promise<{synced: number, failed: number, errors: string[]}>}
 */
export async function syncOutbox({ onProgress } = {}) {
  if (!isOnline()) return { synced: 0, failed: 0, errors: [], offline: true };
  const drafts = await listDrafts();
  const pending = drafts.filter((d) => d.status !== 'synced');
  let synced = 0;
  let failed = 0;
  const errors = [];

  for (const entry of pending) {
    try {
      const { ad } = await syncDraft(entry);
      synced += 1;
      if (onProgress) onProgress({ entry, ad });
      await removeDraft(entry.id);
    } catch (err) {
      failed += 1;
      errors.push(err.message);
      await idb.put(STORE, { ...entry, status: 'error', error: err.message });
    }
  }
  return { synced, failed, errors };
}

/** Donnees d'apercu pour l'ecran "Mes annonces" -> brouillons locaux. */
export async function draftPreview() {
  const rows = await listDrafts();
  return rows.map((r) => ({
    id: r.id,
    title: r.fields?.title || 'Annonce en attente',
    price: r.fields?.price_amount || null,
    photoUrl: r.uploaded?.photoKeys?.[0] ? mediaUrl(r.uploaded.photoKeys[0]) : r.photos?.[0]
      ? URL.createObjectURL(r.photos[0].blob)
      : null,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
  }));
}

export default { enqueueDraft, listDrafts, syncOutbox, pendingCount, removeDraft, newClientUuid, draftPreview };
