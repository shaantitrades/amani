import test from 'node:test';
import assert from 'node:assert/strict';
import { TABS, activeTab, normalizePath, tabBarVisible, tabPath } from '../src/lib/nav.js';
import { countUnread, newestAlertAt } from '../src/lib/alerts.js';
import {
  CALL_LOG_LIMIT,
  callEntryId,
  callLabel,
  callLink,
  clearCalls,
  listCalls,
  logCall,
} from '../src/lib/calls.js';
import { LANGUAGES, t } from '../src/i18n/index.js';

test('la barre du bas contient les raccourcis demandes, plus l accueil', () => {
  assert.deepEqual(
    TABS.map((tab) => tab.key),
    ['home', 'messages', 'calls', 'my_ads', 'notifications'],
  );
  for (const tab of TABS) {
    assert.ok(tab.icon, `icone manquante pour ${tab.key}`);
    assert.equal(tab.path, tabPath(tab.key));
    assert.ok(tab.path.startsWith('/'));
  }
});

test('chaque libelle d onglet est traduit (fr et ar) et jamais brut', () => {
  for (const tab of TABS) {
    for (const lang of ['fr', 'ar']) {
      const value = t(lang, tab.labelKey);
      assert.ok(value && value !== tab.labelKey, `${lang}.${tab.labelKey} manquant`);
    }
    // Les langues partielles retombent sur le francais : jamais la cle brute
    for (const { code } of LANGUAGES) {
      assert.ok(t(code, tab.labelKey) !== tab.labelKey, `${code}.${tab.labelKey} vide`);
    }
  }
});

test('la barre du bas disparait sur les ecrans plein ecran', () => {
  for (const path of ['/welcome', '/login', '/sell', '/ad/4b1c', '/messages/9f2a', '/group/77']) {
    assert.equal(tabBarVisible(path), false, `${path} doit masquer la barre`);
  }
  for (const path of ['/', '/home', '/browse', '/messages', '/calls', '/my-ads', '/notifications', '/account', '/blocked']) {
    assert.equal(tabBarVisible(path), true, `${path} doit garder la barre`);
  }
});

test('l onglet actif suit la route courante', () => {
  assert.equal(activeTab('/home'), 'home');
  assert.equal(activeTab('/browse'), 'home');
  assert.equal(activeTab('/'), 'home');
  assert.equal(activeTab('/messages'), 'messages');
  assert.equal(activeTab('/messages/9f2a'), 'messages');
  assert.equal(activeTab('/calls'), 'calls');
  assert.equal(activeTab('/my-ads'), 'my_ads');
  assert.equal(activeTab('/notifications'), 'notifications');
  // Ecrans hors onglets : aucun onglet surligne
  assert.equal(activeTab('/account'), null);
  assert.equal(activeTab('/blocked'), null);
});

test('normalizePath ignore le slash final et les parametres', () => {
  assert.equal(normalizePath('/messages/'), '/messages');
  assert.equal(normalizePath('/calls?a=1'), '/calls');
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath(undefined), '/');
});

test('countUnread ne compte que les alertes posterieures au marqueur', () => {
  const items = [
    { created_at: '2026-09-26T10:00:00.000Z' },
    { created_at: '2026-09-26T09:00:00.000Z' },
    { created_at: '2026-09-25T09:00:00.000Z' },
  ];
  const seenAt = new Date('2026-09-26T09:30:00.000Z').getTime();
  assert.equal(countUnread(items, seenAt), 1);
  assert.equal(countUnread(items, 0), 3);
  assert.equal(countUnread([], seenAt), 0);
  assert.equal(countUnread([{ created_at: null }], seenAt), 0);
});

test('newestAlertAt retient l heure serveur la plus recente', () => {
  assert.equal(newestAlertAt([]), 0);
  assert.equal(newestAlertAt([{ created_at: null }]), 0);
  assert.equal(
    newestAlertAt([{ created_at: '2026-09-26T10:00:00.000Z' }, { created_at: '2026-09-26T12:00:00.000Z' }]),
    Date.parse('2026-09-26T12:00:00.000Z'),
  );
});

test('l historique d appels reste utilisable sans IndexedDB', async () => {
  assert.equal(callLabel({ name: 'Awa' }), 'Awa');
  assert.equal(callLabel({ phone: '+23566123456' }), '+235 66 12 34 56');
  assert.equal(callLink('+235 66 12 34 56'), 'tel:+23566123456');
  assert.equal(callEntryId('+23566123456', 1_700_000_000_000), '+23566123456-1700000000');
  // Sans stockage local : aucune exception, l'application continue de marcher
  assert.equal(await logCall({ phone: '+23566123456' }), null);
  assert.equal(await logCall({ name: 'sans numero' }), null);
  assert.deepEqual(await listCalls(), []);
  assert.equal(await clearCalls(), false);
  assert.ok(CALL_LOG_LIMIT >= 30);
});
