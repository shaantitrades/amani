import test from 'node:test';
import assert from 'node:assert/strict';
import { adShareText, adShareUrl, canNativeShare, whatsappShareLink } from '../src/lib/share.js';

test('adShareUrl construit un lien stable d\'annonce', () => {
  assert.equal(adShareUrl('abc-123', 'https://bodogui.com'), 'https://bodogui.com/ad/abc-123');
  assert.equal(adShareUrl('abc-123', 'https://bodogui.com/'), 'https://bodogui.com/ad/abc-123');
  assert.equal(adShareUrl(null, 'https://bodogui.com'), 'https://bodogui.com');
});

test('adShareText decrit l\'annonce et invite a ouvrir l\'application', () => {
  const text = adShareText(
    { title: 'Vache laitiere', price_label: '285 000 FCFA', district_name: 'Moursal' },
    'https://bodogui.com/ad/x',
  );
  assert.match(text, /Vache laitiere/);
  assert.match(text, /285 000 FCFA/);
  assert.match(text, /Moursal/);
  assert.match(text, /https:\/\/bodogui\.com\/ad\/x$/);
});

test('adShareText fonctionne avec un minimum d\'informations', () => {
  const text = adShareText({}, '');
  assert.match(text, /Annonce Bodogui/);
});

test('whatsappShareLink encode le message', () => {
  const link = whatsappShareLink('Bonjour & merci');
  assert.match(link, /^https:\/\/wa\.me\/\?text=/);
  assert.match(link, /Bonjour%20%26%20merci/);
});

test('canNativeShare detecte l\'API de partage du telephone', () => {
  assert.equal(canNativeShare({ navigator: { share: () => {} } }), true);
  assert.equal(canNativeShare({ navigator: {} }), false);
  assert.equal(canNativeShare(null), false);
});
