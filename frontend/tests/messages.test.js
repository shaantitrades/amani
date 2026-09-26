import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fileExtension,
  imageKey,
  isFileMessage,
  isImageMessage,
  isVoiceMessage,
  messagePreview,
  validateFileForUpload,
} from '../src/lib/messages.js';


test('messagePreview resume chaque type de message', () => {
  assert.equal(messagePreview({ kind: 'text', body: 'Bonjour' }), 'Bonjour');
  assert.equal(messagePreview({ kind: 'voice', transcript: 'vache a vendre' }), '🎙️ vache a vendre');
  assert.equal(messagePreview({ kind: 'voice' }), '🎙️ Message vocal');
  assert.equal(messagePreview({ kind: 'image', file_key: 'photos/x.webp' }), '📷 Photo');
  assert.equal(messagePreview({ kind: 'file', file_name: 'facture.pdf' }), '📄 facture.pdf');
  assert.equal(messagePreview({ kind: 'file' }), '📄 Document');
  assert.equal(messagePreview(null), '');
});

test('les detecteurs de type ne se trompent pas', () => {
  assert.equal(isImageMessage({ kind: 'image', file_key: 'a.webp' }), true);
  assert.equal(isImageMessage({ kind: 'image' }), false, 'sans fichier ce n\'est pas une photo affichable');
  assert.equal(isFileMessage({ kind: 'file', file_key: 'a.pdf' }), true);
  assert.equal(isFileMessage({ kind: 'image', file_key: 'a.webp' }), false);
  assert.equal(isVoiceMessage({ kind: 'voice', audio_key: 'a.ogg' }), true);
  assert.equal(isVoiceMessage({ kind: 'text', body: 'x' }), false);
});

test('imageKey prefere la vignette (economie de donnees)', () => {
  assert.equal(imageKey({ kind: 'image', file_key: 'full.webp', thumb_key: 'thumb.webp' }), 'thumb.webp');
  assert.equal(imageKey({ kind: 'image', file_key: 'full.webp' }), 'full.webp');
  assert.equal(imageKey({ kind: 'text' }), null);
});

test('validateFileForUpload refuse les types dangereux et les gros fichiers', () => {
  const file = (name, size) => ({ name, size });
  assert.equal(validateFileForUpload(file('facture.pdf', 1000)).ok, true);
  assert.equal(validateFileForUpload(file('liste.xlsx', 1000)).ok, true);
  assert.equal(validateFileForUpload(file('virus.exe', 1000)).reason, 'extension');
  assert.equal(validateFileForUpload(file('app.apk', 1000)).reason, 'extension');
  assert.equal(validateFileForUpload(file('gros.pdf', 6 * 1024 * 1024)).reason, 'size');
  assert.equal(validateFileForUpload(null).ok, false);
  assert.equal(fileExtension('FACTURE.PDF'), 'pdf');
});
