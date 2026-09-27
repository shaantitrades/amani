import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SMS_TEMPLATES, renderTemplate, sendSms } from '../src/services/sms.js';
import { VOICE_PROMPTS, isSupportedLanguage, languageMeta, promptText, promptUrl, manifest } from '../src/services/voice.js';

test('les modeles SMS existent dans les 3 langues du pilote', () => {
  for (const [kind, byLang] of Object.entries(SMS_TEMPLATES)) {
    for (const lang of ['fr', 'ar', 'ff']) {
      assert.ok(typeof byLang[lang] === 'function', `${kind}.${lang} manquant`);
    }
  }
});

test('renderTemplate remplace le code et le nom de l\'application', () => {
  const body = renderTemplate('otp', 'fr', { code: '12345' });
  assert.match(body, /12345/);
  assert.match(body, /Bodogui/);
  assert.ok(body.length < 160, 'un SMS doit rester court');
});

test('renderTemplate retombe sur le francais pour une langue inconnue', () => {
  const fr = renderTemplate('ban', 'fr');
  const unknown = renderTemplate('ban', 'xx');
  assert.equal(unknown, fr);
});

test('renderTemplate refuse un modele inconnu', () => {
  assert.throws(() => renderTemplate('nope', 'fr'), /Modele SMS inconnu/);
});

test('sendSms en mode console simule l\'envoi', async () => {
  const res = await sendSms({ to: '+23566000000', body: 'Test' });
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'console');
  assert.equal(res.simulated, true);
});

test('promptUrl pointe vers un fichier Opus par langue', () => {
  assert.equal(promptUrl('ad_published', 'fr'), '/voice/fr/ad_published.opus');
  assert.equal(promptUrl('blocked', 'ar'), '/voice/ar/blocked.opus');
  assert.equal(promptUrl('blocked', 'zz'), '/voice/fr/blocked.opus'); // repli
});

test('promptText fournit toujours un texte (jamais de silence)', () => {
  assert.match(promptText('photo_added'), /Photo ajoutee/i);
  assert.equal(promptText('cle_inexistante'), VOICE_PROMPTS.error_generic);
});

test('chaque cle de message vocal a un script francais', () => {
  for (const [key, text] of Object.entries(VOICE_PROMPTS)) {
    assert.ok(text && text.length > 3, `script manquant pour ${key}`);
  }
});

test('le manifeste vocal couvre toutes les langues et toutes les cles', () => {
  const langs = manifest();
  assert.equal(langs.length, 3);
  for (const l of langs) {
    assert.equal(l.prompts.length, Object.keys(VOICE_PROMPTS).length);
    assert.ok(l.baseUrl.endsWith('/'));
  }
});

test('metadonnees de langue (RTL pour l\'arabe)', () => {
  assert.equal(isSupportedLanguage('ff'), true);
  assert.equal(isSupportedLanguage('en'), false);
  assert.equal(languageMeta('ar').dir, 'rtl');
  assert.equal(languageMeta('inconnu').code, 'fr');
});
