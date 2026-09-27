import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AD_INTRO_NO_TITLE,
  adIntroText,
  afterLoginPath,
  chatPath,
  chatStateFromAd,
  localPathFromUrl,
  splitLinks,
} from '../src/lib/chat.js';
import { t } from '../src/i18n/index.js';

test('chatPath ouvre la conversation interne avec un utilisateur', () => {
  assert.equal(chatPath('uuid-vendeur'), '/messages/uuid-vendeur');
  // Sans identifiant, on retombe sur la liste des discussions
  assert.equal(chatPath(null), '/messages');
  assert.equal(chatPath(undefined), '/messages');
});

test('chatStateFromAd transporte le vendeur, l annonce et son lien', () => {
  const state = chatStateFromAd(
    {
      id: 'ad-1',
      title: 'Vache laitiere',
      owner_id: 'vendeur-1',
      owner_name: 'Achta',
      owner_phone: '+23566123456',
    },
    'https://bodogui.com',
  );
  assert.deepEqual(state, {
    fromAd: true,
    name: 'Achta',
    phone: '+23566123456',
    adId: 'ad-1',
    adTitle: 'Vache laitiere',
    adUrl: 'https://bodogui.com/ad/ad-1',
  });
  // Annonce sans identifiant : pas de lien a joindre, le reste reste utilisable
  assert.deepEqual(chatStateFromAd({}, 'https://bodogui.com'), {
    fromAd: true,
    name: null,
    phone: null,
    adId: null,
    adTitle: null,
    adUrl: null,
  });
  assert.equal(chatStateFromAd().fromAd, true);
  // L'origine du navigateur donne un lien absolu, pret a etre envoye
  assert.equal(chatStateFromAd({ id: 'ad-2' }, 'http://localhost:5173').adUrl, 'http://localhost:5173/ad/ad-2');
});

test('adIntroText pre-remplit une phrase d accroche avec le titre et le lien', () => {
  assert.equal(
    adIntroText({ title: 'Vache laitiere', url: 'https://bodogui.com/ad/ad-1' }),
    "Bonjour, votre annonce « Vache laitiere » m'interesse. Est-elle toujours disponible ?\nhttps://bodogui.com/ad/ad-1",
  );
  // Sans lien connu, aucune ligne vide ne doit rester dans le message
  assert.equal(
    adIntroText({ title: 'Vache laitiere' }),
    "Bonjour, votre annonce « Vache laitiere » m'interesse. Est-elle toujours disponible ?",
  );
  // Sans titre, la phrase reste correcte et le lien est quand meme joint
  assert.equal(adIntroText({ url: 'https://bodogui.com/ad/9' }), `${AD_INTRO_NO_TITLE}\nhttps://bodogui.com/ad/9`);
  assert.equal(adIntroText({}), AD_INTRO_NO_TITLE);
  assert.equal(adIntroText({ title: '   ' }), AD_INTRO_NO_TITLE);
});

test('adIntroText utilise le gabarit de la langue choisie (titre et lien)', () => {
  for (const lang of ['fr', 'ar', 'ff']) {
    const template = t(lang, 'ad_intro_message');
    const message = adIntroText({ title: 'Vache', url: 'https://bodogui.com/ad/1' }, template);
    assert.ok(!message.includes('{title}'), `${lang} : le titre doit etre insere`);
    assert.ok(!message.includes('{link}'), `${lang} : le lien doit etre insere`);
    assert.ok(message.includes('Vache'), `${lang} : titre absent du message`);
    assert.ok(message.endsWith('https://bodogui.com/ad/1'), `${lang} : lien absent du message`);
  }
  // Un gabarit sans emplacement de titre est renvoye tel quel
  assert.equal(adIntroText({ title: 'Vache' }, 'Bonjour'), 'Bonjour');
  // Gabarit sans emplacement de lien : le lien est pose a la fin
  assert.equal(adIntroText({ title: 'Vache', url: 'https://x.test/ad/1' }, 'Bonjour {title}'), 'Bonjour Vache\nhttps://x.test/ad/1');
});

test('splitLinks separe le texte des liens http', () => {
  assert.deepEqual(splitLinks(''), []);
  assert.deepEqual(splitLinks(), []);
  assert.deepEqual(splitLinks('Bonjour'), [{ type: 'text', value: 'Bonjour' }]);
  assert.deepEqual(splitLinks('Voir https://bodogui.com/ad/1 merci'), [
    { type: 'text', value: 'Voir ' },
    { type: 'link', value: 'https://bodogui.com/ad/1' },
    { type: 'text', value: ' merci' },
  ]);
  // Lien colle a du texte : il reste detecte
  assert.deepEqual(splitLinks('Annonce:https://bodogui.com/ad/2'), [
    { type: 'text', value: 'Annonce:' },
    { type: 'link', value: 'https://bodogui.com/ad/2' },
  ]);
  // Le lien de l'accroche termine le message : la bulle peut le rendre cliquable
  const parts = splitLinks(adIntroText({ title: 'Vache', url: 'https://bodogui.com/ad/3' }));
  assert.deepEqual(parts[parts.length - 1], { type: 'link', value: 'https://bodogui.com/ad/3' });
});

test('localPathFromUrl garde les liens de l application dedans', () => {
  assert.equal(localPathFromUrl('https://bodogui.com/ad/12', 'https://bodogui.com'), '/ad/12');
  assert.equal(localPathFromUrl('http://localhost:5173/ad/12', 'http://localhost:5173'), '/ad/12');
  assert.equal(localPathFromUrl('/ad/12'), '/ad/12');
  // Un autre site (ou une adresse douteuse) n'est jamais ouvert dans l'app
  assert.equal(localPathFromUrl('https://exemple.test/ad/12', 'https://bodogui.com'), null);
  assert.equal(localPathFromUrl('//exemple.test/ad/12', 'https://bodogui.com'), null);
  assert.equal(localPathFromUrl('https://bodogui.com', 'https://bodogui.com'), null);
  assert.equal(localPathFromUrl(''), null);
  assert.equal(localPathFromUrl(null), null);
});

test('afterLoginPath ramene sur l annonce partagee, sinon a l accueil', () => {
  assert.equal(afterLoginPath('/ad/123'), '/ad/123');
  assert.equal(afterLoginPath('/messages/uuid'), '/messages/uuid');
  assert.equal(afterLoginPath(undefined), '/home');
  assert.equal(afterLoginPath(''), '/home');
  assert.equal(afterLoginPath(null), '/home');
  // Pas de redirection ouverte vers un autre site
  assert.equal(afterLoginPath('https://exemple.test/ad/123'), '/home');
  assert.equal(afterLoginPath('//exemple.test'), '/home');
});
