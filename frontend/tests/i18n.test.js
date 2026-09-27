import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGES,
  VOICE_PROMPT_KEYS,
  categoryLabel,
  districtLabel,
  isSupportedLanguage,
  languageMeta,
  promptText,
  promptUrl,
  t,
} from '../src/i18n/index.js';
import { makeIcon, readPngInfo } from '../scripts/generate-icons.mjs';

test('les 3 langues du pilote sont disponibles', () => {
  assert.equal(LANGUAGES.length, 3);
  assert.deepEqual(
    LANGUAGES.map((l) => l.code),
    ['fr', 'ar', 'ff'],
  );
  assert.equal(languageMeta('ar').dir, 'rtl');
  assert.equal(isSupportedLanguage('zz'), false);
});

test('t() retombe sur le francais quand la traduction manque', () => {
  assert.equal(t('fr', 'sell'), 'VENDRE');
  assert.equal(t('ar', 'call'), 'اتصل');
  // "storage_label" n'existe qu'en francais : repli attendu
  assert.equal(t('ff', 'storage_label'), t('fr', 'storage_label'));
  // Cle totalement inconnue : on affiche la cle plutot que du vide
  assert.equal(t('fr', 'cle_inconnue'), 'cle_inconnue');
});

test('les messages d\'erreur de l\'API sont lisibles dans les 3 langues', () => {
  // Les cles error_* viennent de l'API (voiceKey) : elles ne sont pas dans les
  // dictionnaires mais dans strings/voice.js. Sans repli, l'utilisateur lisait
  // la cle brute (« error_phone_invalid ») au lieu d'une phrase.
  const keys = [
    'error_generic',
    'error_offline',
    'error_phone_invalid',
    'error_code_invalid',
    'error_code_expired',
    'error_code_rate_limited',
    'error_rate_limited',
    'error_forbidden',
    'error_banned',
    'error_too_many_photos',
    'error_description_required',
    'error_blocked_target',
  ];
  for (const lang of LANGUAGES.map((l) => l.code)) {
    for (const key of keys) {
      const value = t(lang, key);
      assert.ok(value && value !== key, `${lang}.${key} doit afficher une phrase`);
    }
  }
  // Une cle totalement inconnue reste affichee telle quelle (aucun texte vide).
  assert.equal(t('fr', 'cle_inconnue'), 'cle_inconnue');
});

test('chaque langue possede les libelles des actions essentielles', () => {
  const essentials = ['sell', 'buy', 'groups', 'account', 'call', 'publish', 'speak', 'price', 'where', 'category'];
  for (const lang of LANGUAGES.map((l) => l.code)) {
    for (const key of essentials) {
      const value = t(lang, key);
      assert.ok(value && value !== key, `${lang}.${key} manquant`);
    }
  }
});

test('le quartier du profil est traduit dans les 3 langues', () => {
  // Le quartier se choisit une seule fois (« Mon compte ») : il ne doit pas
  // apparaitre en francais a un utilisateur arabophone, fulfulde.
  const codes = LANGUAGES.map((l) => l.code);
  assert.ok(codes.includes('fr'));
  for (const key of ['my_district', 'no_district']) {
    assert.ok(t('fr', key) && t('fr', key) !== key, `fr.${key} manquant`);
    for (const lang of codes.filter((code) => code !== 'fr')) {
      const value = t(lang, key);
      assert.ok(value && value !== key, `${lang}.${key} manquant`);
      assert.notEqual(value, t('fr', key), `${lang}.${key} doit etre traduit, pas replie sur le francais`);
    }
  }
});

test('la discussion avec le vendeur est traduite dans les 3 langues', () => {
  // Parler a un vendeur se fait dans Bodogui : le bouton DISCUTER, l'accroche
  // pre-remplie, le rappel de l'annonce et la raison de l'inscription ne
  // doivent jamais apparaitre en francais a un utilisateur arabophone,
  // fulfulde.
  const codes = LANGUAGES.map((l) => l.code);
  assert.ok(codes.includes('fr'));
  for (const key of ['discuss', 'login_to_chat', 'about_ad', 'ad_intro_message']) {
    assert.ok(t('fr', key) && t('fr', key) !== key, `fr.${key} manquant`);
    for (const lang of codes.filter((code) => code !== 'fr')) {
      const value = t(lang, key);
      assert.ok(value && value !== key, `${lang}.${key} manquant`);
      assert.notEqual(value, t('fr', key), `${lang}.${key} doit etre traduit, pas replie sur le francais`);
    }
  }
  // L'accroche contient l'emplacement du titre et celui du lien de l'annonce
  for (const lang of codes) {
    assert.match(t(lang, 'ad_intro_message'), /\{title\}/, `${lang}.ad_intro_message doit contenir {title}`);
    assert.match(t(lang, 'ad_intro_message'), /\{link\}/, `${lang}.ad_intro_message doit contenir {link}`);
  }
  // Plus aucun libelle de contact WhatsApp : la conversation reste dans l'app
  for (const lang of codes) {
    assert.equal(t(lang, 'whatsapp'), 'whatsapp', 'la cle whatsapp doit avoir disparu des libelles');
  }
});

test('les actions sensibles du compte sont traduites dans les 3 langues', () => {
  // « Mon compte » garde une zone sensible : le libelle qui l'ouvre, celui du
  // bouton de suppression et son avertissement doivent etre lisibles dans les
  // 3 langues du pilote (la suppression efface annonces et messages).
  const codes = LANGUAGES.map((l) => l.code);
  for (const key of ['account_options', 'delete_account', 'delete_account_hint', 'confirm_delete_account']) {
    assert.ok(t('fr', key) && t('fr', key) !== key, `fr.${key} manquant`);
    for (const lang of codes.filter((code) => code !== 'fr')) {
      const value = t(lang, key);
      assert.ok(value && value !== key, `${lang}.${key} manquant`);
      assert.notEqual(value, t('fr', key), `${lang}.${key} doit etre traduit, pas replie sur le francais`);
    }
  }
});

test('le changement de langue est confirme et traduit dans les 3 langues', () => {
  // La question de confirmation s'affiche dans la langue ACTUELLE : elle doit
  // donc exister partout, avec l'emplacement du nom de la langue visee.
  const codes = LANGUAGES.map((l) => l.code);
  for (const key of ['confirm_language', 'language_changed']) {
    assert.ok(t('fr', key) && t('fr', key) !== key, `fr.${key} manquant`);
    for (const lang of codes.filter((code) => code !== 'fr')) {
      const value = t(lang, key);
      assert.ok(value && value !== key, `${lang}.${key} manquant`);
      assert.notEqual(value, t('fr', key), `${lang}.${key} doit etre traduit, pas replie sur le francais`);
    }
  }
  for (const lang of codes) {
    assert.match(
      t(lang, 'confirm_language'),
      /\{language\}/,
      `${lang}.confirm_language doit contenir {language}`,
    );
  }
});

test('l\'installation obligatoire est expliquee dans les 3 langues', () => {
  // Le portail d'installation remplace toute l'application : un visiteur qui ne
  // comprend ni le francais ni l'anglais doit savoir quoi faire.
  const codes = LANGUAGES.map((l) => l.code);
  for (const key of ['install_required_message', 'install_open_browser']) {
    assert.ok(t('fr', key) && t('fr', key) !== key, `fr.${key} manquant`);
    for (const lang of codes.filter((code) => code !== 'fr')) {
      const value = t(lang, key);
      assert.ok(value && value !== key, `${lang}.${key} manquant`);
      assert.notEqual(value, t('fr', key), `${lang}.${key} doit etre traduit, pas replie sur le francais`);
    }
  }
});


test('promptUrl pointe vers les fichiers Opus par langue', () => {
  assert.equal(promptUrl('ad_published', 'fr'), '/voice/fr/ad_published.opus');
  assert.equal(promptUrl('blocked', 'ff'), '/voice/ff/blocked.opus');
  assert.equal(promptUrl('blocked', 'zz'), '/voice/fr/blocked.opus');
});

test('promptText fournit toujours un texte lisible', () => {
  assert.match(promptText('ad_published'), /publiee/);
  assert.match(promptText('inconnu'), /erreur/i);
  assert.ok(VOICE_PROMPT_KEYS.length > 30, 'catalogue vocal trop pauvre');
});

test('categoryLabel et districtLabel choisissent la bonne langue', () => {
  const category = { code: 'animaux', label_fr: 'Animaux', label_ar: 'حيوانات' };
  assert.equal(categoryLabel(category, 'fr'), 'Animaux');
  assert.equal(categoryLabel(category, 'ar'), 'حيوانات');
  assert.equal(categoryLabel(category, 'ff'), 'Animaux'); // repli
  const district = { name: "N'Djamena", name_ar: 'أنجمينا' };
  assert.equal(districtLabel(district, 'ar'), 'أنجمينا');
  assert.equal(districtLabel(district, 'fr'), "N'Djamena");
});

test('le generateur d\'icones produit des PNG valides', () => {
  for (const size of [192, 512]) {
    const info = readPngInfo(makeIcon(size));
    assert.equal(info.signatureOk, true);
    assert.equal(info.width, size);
    assert.equal(info.height, size);
    assert.equal(info.colorType, 6); // RGBA
  }
  const maskable = readPngInfo(makeIcon(512, true));
  assert.equal(maskable.width, 512);
});
