import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPrice,
  formatPriceShort,
  priceToSpeech,
  relativeTime,
  formatDuration,
  formatBytes,
  formatPhone,
  telLink,
  dialCode,
  DEFAULT_DIAL_CODE,
} from '../src/lib/format.js';

test('formatPrice affiche les francs CFA avec separateurs', () => {
  assert.equal(formatPrice(285000, 'XAF'), '285 000 FCFA');
  assert.equal(formatPrice(0, 'XAF'), '0 FCFA');
  assert.equal(formatPrice(null), '');
  assert.equal(formatPrice('abc'), '');
  assert.equal(formatPrice(1500, 'USD'), '1 500 $');
});

test('formatPriceShort convient aux vignettes', () => {
  assert.equal(formatPriceShort(1200000, 'XAF'), '1,2 M F');
  assert.equal(formatPriceShort(285000, 'XAF'), '285 K F');
  assert.equal(formatPriceShort(900, 'XAF'), '900 F');
});

test('priceToSpeech prepare une lecture vocale claire', () => {
  assert.equal(priceToSpeech(250000, 'XAF'), '250000 francs CFA');
  assert.equal(priceToSpeech(50, 'USD'), '50 dollars');
});

test('relativeTime produit des libelles courts', () => {
  const now = new Date('2026-01-10T12:00:00Z');
  assert.equal(relativeTime('2026-01-10T11:59:30Z', now), "a l'instant");
  assert.equal(relativeTime('2026-01-10T11:30:00Z', now), 'il y a 30 min');
  assert.equal(relativeTime('2026-01-10T06:00:00Z', now), 'il y a 6 h');
  assert.equal(relativeTime('2026-01-09T12:00:00Z', now), 'hier');
});

test('formatDuration et formatBytes', () => {
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(9), '0:09');
  assert.equal(formatBytes(2048), '2 Ko');
  assert.equal(formatBytes(1536 * 1024), '1.5 Mo');
});

test('formatPhone affiche un numero tchadien lisible, sans masquage', () => {
  assert.equal(formatPhone('+23566123456'), '+235 66 12 34 56');
  assert.equal(formatPhone(''), '');
});

test('telLink est pret pour le bouton Appeler (aucun lien WhatsApp)', () => {
  assert.equal(telLink('+235 66 12 34 56'), 'tel:+23566123456');
});

test('dialCode ne plante jamais, meme si le referentiel est vide', () => {
  // Cas reel : /api/v1/bootstrap pas encore charge (ou hors ligne)
  assert.equal(dialCode([]), '235');
  assert.equal(dialCode(undefined), '235');
  assert.equal(dialCode(null), '235');
  assert.equal(dialCode([{ code: 'TD', dial: '235' }]), '235');
  // Tableau present mais incomplet : on prend le premier indicatif valide
  assert.equal(dialCode([{ code: 'XX' }, { code: 'CM', dial: '237' }]), '237');
  assert.equal(dialCode([{}], '226'), '226');
  assert.equal(DEFAULT_DIAL_CODE, '235');
});
