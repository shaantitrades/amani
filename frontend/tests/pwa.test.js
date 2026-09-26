import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTALL_COOLDOWN_DAYS,
  isIos,
  isStandalone,
  markDismissed,
  markGateBypassed,
  markInstalled,
  readInstallState,
  shouldShowInstallGate,
  shouldShowInstallPrompt,
} from '../src/lib/pwa.js';

/** Faux localStorage pour tester la persistance sans navigateur. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _dump: () => Object.fromEntries(map),
  };
}

function fakeWindow({ displayMode = null, iosStandalone = false, referrer = '', ua = 'Mozilla/5.0' } = {}) {
  return {
    matchMedia: (query) => ({ matches: query.includes(displayMode || '__none__') }),
    navigator: { standalone: iosStandalone, userAgent: ua },
    document: { referrer },
  };
}

test('isStandalone detecte les modes installes', () => {
  assert.equal(isStandalone(fakeWindow({ displayMode: 'standalone' })), true);
  assert.equal(isStandalone(fakeWindow({ displayMode: 'minimal-ui' })), true);
  assert.equal(isStandalone(fakeWindow({ iosStandalone: true })), true); // iOS
  assert.equal(isStandalone(fakeWindow({ referrer: 'android-app://com.android.chrome' })), true);
  assert.equal(isStandalone(fakeWindow()), false); // navigateur classique
  assert.equal(isStandalone(null), true); // hors navigateur : rien a proposer
});

test('isIos reconnait iPhone/iPad mais pas Android', () => {
  assert.equal(isIos(fakeWindow({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })), true);
  assert.equal(isIos(fakeWindow({ ua: 'Mozilla/5.0 (Linux; Android 13; SM-A045F)' })), false);
});

test('l\'invitation ne s\'affiche JAMAIS si l\'application est installee', () => {
  assert.equal(shouldShowInstallPrompt({ standalone: true, canPrompt: true }).show, false);
  assert.equal(shouldShowInstallPrompt({ installed: true, canPrompt: true }).show, false);
  assert.equal(
    shouldShowInstallPrompt({ standalone: false, installed: true, canPrompt: true, dismissedAt: null }).reason,
    'already_installed',
  );
});

test('l\'invitation s\'affiche quand le navigateur peut installer', () => {
  const decision = shouldShowInstallPrompt({ canPrompt: true, ios: false });
  assert.equal(decision.show, true);
  assert.equal(decision.reason, 'prompt_available');
});

test('l\'invitation s\'affiche sur iPhone avec les instructions manuelles', () => {
  const decision = shouldShowInstallPrompt({ canPrompt: false, ios: true });
  assert.equal(decision.show, true);
  assert.equal(decision.reason, 'ios_manual_install');
});

test('aucune invitation si le navigateur ne sait pas installer et n\'est pas iOS', () => {
  assert.equal(shouldShowInstallPrompt({ canPrompt: false, ios: false }).show, false);
  assert.equal(shouldShowInstallPrompt({ canPrompt: false, ios: false }).reason, 'unsupported');
});

test('apres un refus, l\'invitation est mise en pause quelques jours', () => {
  const now = Date.now();
  const recently = now - 1 * 86400000; // il y a 1 jour
  const old = now - (INSTALL_COOLDOWN_DAYS + 1) * 86400000;

  assert.equal(shouldShowInstallPrompt({ canPrompt: true, dismissedAt: recently, now }).show, false);
  assert.equal(shouldShowInstallPrompt({ canPrompt: true, dismissedAt: recently, now }).reason, 'snoozed');
  assert.equal(shouldShowInstallPrompt({ canPrompt: true, dismissedAt: old, now }).show, true);
});

test('markInstalled / markDismissed persistent l\'etat', () => {
  const storage = fakeStorage();
  markInstalled(storage);
  assert.equal(readInstallState(storage).installed, true);
  markDismissed(storage);
  const state = readInstallState(storage);
  assert.equal(state.installed, true, 'l\'information d\'installation est conservee');
  assert.ok(state.dismissedAt > 0);

  // Le mode installe ne propose plus jamais l'installation
  assert.equal(
    shouldShowInstallPrompt({ installed: state.installed, canPrompt: true, dismissedAt: state.dismissedAt }).show,
    false,
  );
});

test('readInstallState resiste a un stockage corrompu ou absent', () => {
  assert.deepEqual(readInstallState(fakeStorage({ 'bodogui.install': 'pas du json' })), {});

test('le portail d\'installation bloque tant que l\'application n\'est pas installee', () => {
  // Navigateur qui sait installer : blocage total.
  assert.equal(shouldShowInstallGate({ enabled: true, canPrompt: true }).block, true);
  assert.equal(shouldShowInstallGate({ enabled: true, canPrompt: true }).reason, 'prompt_available');
  // iPhone : installation manuelle, mais blocage aussi.
  assert.equal(shouldShowInstallGate({ enabled: true, ios: true }).block, true);
  assert.equal(shouldShowInstallGate({ enabled: true, ios: true }).reason, 'ios_manual_install');
  // Navigateur muet (evenement jamais recu) : blocage pendant l'attente.
  assert.equal(shouldShowInstallGate({ enabled: true }).block, true);
  assert.equal(shouldShowInstallGate({ enabled: true }).reason, 'waiting_prompt');
});

test('le portail laisse passer une application deja installee ou desactive', () => {
  assert.equal(shouldShowInstallGate({ enabled: true, standalone: true }).block, false);
  assert.equal(shouldShowInstallGate({ enabled: true, installed: true }).block, false);
  assert.equal(shouldShowInstallGate({ enabled: true, bypassed: true }).block, false);
  assert.equal(shouldShowInstallGate({ enabled: true, standalone: true }).reason, 'already_standalone');
  assert.equal(shouldShowInstallGate({ enabled: false }).block, false);
});

test('aucune sortie du portail quand le navigateur sait installer', () => {
  // Le visiteur ne peut pas contourner : il doit installer.
  assert.equal(shouldShowInstallGate({ enabled: true, canPrompt: true, settled: true }).canEscape, false);
  assert.equal(shouldShowInstallGate({ enabled: true, ios: true, settled: false }).canEscape, false);
  // Installation refusee depuis la boite de dialogue : toujours aucune sortie
  // pendant la visite (recharger la page repropose l'installation).
  const refused = shouldShowInstallGate({ enabled: true, settled: true, promptUsed: true });
  assert.equal(refused.block, true);
  assert.equal(refused.canEscape, false);
  assert.equal(refused.reason, 'prompt_refused');
  // iPhone et navigateurs sans installation : porte de sortie apres l'attente,
  // sans quoi ces visiteurs seraient definitivement bloques.
  assert.equal(shouldShowInstallGate({ enabled: true, ios: true, settled: true }).canEscape, true);
  assert.equal(shouldShowInstallGate({ enabled: true, settled: true }).canEscape, true);
  assert.equal(shouldShowInstallGate({ enabled: true, settled: true }).reason, 'unsupported');
});

test('markGateBypassed autorise la poursuite dans le navigateur', () => {
  const storage = fakeStorage();
  markGateBypassed(storage);
  const state = readInstallState(storage);
  assert.equal(state.bypassed, true);
  assert.equal(shouldShowInstallGate({ enabled: true, bypassed: state.bypassed, settled: true }).block, false);
});

  assert.deepEqual(readInstallState(null), {});
});
