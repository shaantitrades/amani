import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFromAd, editPayload, isStoredPhoto, splitPhotos } from '../src/lib/adEdit.js';

const ad = {
  id: 'ad-1',
  category_id: 'cat-1',
  title: 'Vache laitiere',
  description_text: 'Trois litres par jour',
  price_amount: 250000,
  photos: [
    { storage_key: 'photos/a.webp', thumb_key: 'thumbs/a.webp' },
    { storage_key: 'photos/b.webp', thumb_key: null },
  ],
};

test('draftFromAd pre-remplit l assistant avec l annonce publiee', () => {
  const draft = draftFromAd(ad);
  assert.equal(draft.title, 'Vache laitiere');
  assert.equal(draft.description_text, 'Trois litres par jour');
  assert.equal(draft.price_amount, '250000', 'le clavier attend une chaine');
  assert.equal(draft.category_id, 'cat-1');
  assert.equal(draft.photos.length, 2);
  assert.equal(draft.photos[0].storage_key, 'photos/a.webp');
  assert.equal(draft.photos[0].thumb_key, 'thumbs/a.webp');
  assert.equal(draft.photos[1].thumb_key, null);
});

test('draftFromAd supporte une annonce sans prix, sans texte ni photo', () => {
  // Les annonces de bergers vivent par leurs photos : aucun champ ne doit
  // afficher "null" dans l'assistant de modification.
  const draft = draftFromAd({ id: 'ad-2', category_id: 'cat-2', price_amount: null, photos: [] });
  assert.equal(draft.price_amount, '');
  assert.equal(draft.title, '');
  assert.equal(draft.description_text, '');
  assert.deepEqual(draft.photos, []);
  assert.equal(draftFromAd().category_id, '', 'aucune annonce : brouillon vide');
});

test('splitPhotos distingue les photos stockees des nouvelles', () => {
  const stored = { storage_key: 'photos/a.webp', thumb_key: 'thumbs/a.webp' };
  const fresh = { blob: { size: 10 }, name: 'nouvelle.webp', previewUrl: 'blob:x' };
  assert.equal(isStoredPhoto(stored), true);
  assert.equal(isStoredPhoto(fresh), false);
  // Une photo reprise du serveur puis remplacee par une prise de vue porte un
  // blob : elle doit repartir au televersement, pas rester "stockee".
  assert.equal(isStoredPhoto({ ...stored, blob: { size: 1 } }), false);

  const split = splitPhotos([stored, fresh, { ...stored, blob: { size: 1 } }]);
  assert.deepEqual(split.stored, [{ storage_key: 'photos/a.webp', thumb_key: 'thumbs/a.webp' }]);
  assert.equal(split.fresh.length, 2);
  assert.deepEqual(splitPhotos(), { stored: [], fresh: [] });
});

test('editPayload conserve les photos gardees et ajoute les nouvelles', () => {
  const draft = draftFromAd(ad);
  draft.photos = [draft.photos[0], { blob: { size: 12 }, name: 'nouvelle.webp' }];
  const body = editPayload(draft, {
    photos: [{ storage_key: 'photos/nouvelle.webp', thumb_key: 'thumbs/nouvelle.webp' }],
  });

  assert.deepEqual(body.photos.map((p) => p.storage_key), ['photos/a.webp', 'photos/nouvelle.webp']);
  assert.equal(body.photos.length, 2);
});

test('editPayload efface un prix ou un titre vide, jamais la categorie', () => {
  const draft = { ...draftFromAd(ad), price_amount: '', title: '   ', description_text: '   ' };
  const body = editPayload(draft);
  assert.equal(body.price_amount, null, 'le prix retire doit partir en null');
  assert.equal(body.title, null);
  assert.equal(body.description_text, null);
  assert.equal(body.category_id, 'cat-1');
  // La colonne `category_id` est obligatoire en base : jamais de null envoye.
  assert.equal('category_id' in editPayload({ ...draft, category_id: '' }), false);
  assert.deepEqual(editPayload({}).photos, [], 'aucune photo : liste vide, pas undefined');
  assert.equal(editPayload({ price_amount: '0' }).price_amount, 0, 'un prix de 0 reste un prix');
});

test('editPayload ne remplace la voix que si elle a ete reenregistree', () => {
  const draft = draftFromAd(ad);
  const kept = editPayload(draft);
  assert.equal('description_audio_key' in kept, false, 'sans nouvel enregistrement, la voix reste');

  const replaced = editPayload(draft, { audio: { key: 'audio/ads/1.ogg', seconds: 9, transcript: 'Bonjour' } });
  assert.equal(replaced.description_audio_key, 'audio/ads/1.ogg');
  assert.equal(replaced.description_audio_seconds, 9);
  assert.equal(replaced.description_transcript, 'Bonjour');
});
