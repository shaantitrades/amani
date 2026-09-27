import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTALL_COOLDOWN_DAYS,
  installGateMode,
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
  assert.deepEqual(readInstallState(null), {});
});

test('installation NON obligatoire : le portail s\'affiche et se quitte a tout moment', () => {
  // Mode par defaut (invite), navigateur qui sait installer : le portail
  // s'affiche, mais « Continuer dans le navigateur » reste disponible.
  const prompt = shouldShowInstallGate({ mode: 'invite', canPrompt: true });
  assert.equal(prompt.block, true);
  assert.equal(prompt.reason, 'prompt_available');
  assert.equal(prompt.canEscape, true);
  // iPhone : invitation avec les instructions manuelles, sortie immediate.
  const ios = shouldShowInstallGate({ mode: 'invite', ios: true });
  assert.equal(ios.block, true);
  assert.equal(ios.reason, 'ios_manual_install');
  assert.equal(ios.canEscape, true);
  // Navigateur muet (evenement jamais recu) : attente puis instructions.
  const waiting = shouldShowInstallGate({ mode: 'invite' });
  assert.equal(waiting.block, true);
  assert.equal(waiting.reason, 'waiting_prompt');
  assert.equal(waiting.canEscape, true);
  // Meme apres avoir ouvert la boite de dialogue native (installation refusee).
  const refused = shouldShowInstallGate({ mode: 'invite', settled: true, promptUsed: true });
  assert.equal(refused.reason, 'prompt_refused');
  assert.equal(refused.canEscape, true);
});

test('installGateMode lit VITE_INSTALL_GATE (invite par defaut)', () => {
  assert.equal(installGateMode(undefined), 'invite');
  assert.equal(installGateMode(''), 'invite');
  assert.equal(installGateMode('invite'), 'invite');
  assert.equal(installGateMode('off'), 'off');
  assert.equal(installGateMode('OFF'), 'off');
  assert.equal(installGateMode('none'), 'off');
  assert.equal(installGateMode('mandatory'), 'mandatory');
  // Anciennes valeurs : elles demandaient le portail bloquant.
  assert.equal(installGateMode('on'), 'mandatory');
  assert.equal(installGateMode('true'), 'mandatory');
});

test('le portail laisse passer une application deja installee ou desactive', () => {
  assert.equal(shouldShowInstallGate({ mode: 'invite', standalone: true }).block, false);
  assert.equal(shouldShowInstallGate({ mode: 'invite', installed: true }).block, false);
  assert.equal(shouldShowInstallGate({ mode: 'invite', bypassed: true }).block, false);
  assert.equal(shouldShowInstallGate({ mode: 'invite', standalone: true }).reason, 'already_standalone');
  assert.equal(shouldShowInstallGate({ mode: 'off' }).block, false);
});

test('le mode mandatory (demonstration) peut encore bloquer l\'application', () => {
  // Portail bloquant : le visiteur doit installer (usage demonstration).
  assert.equal(shouldShowInstallGate({ mode: 'mandatory', canPrompt: true, settled: true }).canEscape, false);
  assert.equal(shouldShowInstallGate({ mode: 'mandatory', ios: true, settled: false }).canEscape, false);
  assert.equal(shouldShowInstallGate({ mode: 'mandatory' }).block, true);
  // Installation refusee depuis la boite de dialogue : aucune sortie pendant la
  // visite (recharger la page repropose l'installation).
  const refused = shouldShowInstallGate({ mode: 'mandatory', settled: true, promptUsed: true });
  assert.equal(refused.block, true);
  assert.equal(refused.canEscape, false);
  assert.equal(refused.reason, 'prompt_refused');
  // iPhone et navigateurs sans installation : porte de sortie apres l'attente,
  // sans quoi ces visiteurs seraient definitivement bloques.
  assert.equal(shouldShowInstallGate({ mode: 'mandatory', ios: true, settled: true }).canEscape, true);
  assert.equal(shouldShowInstallGate({ mode: 'mandatory', settled: true }).canEscape, true);
  assert.equal(shouldShowInstallGate({ mode: 'mandatory', settled: true }).reason, 'unsupported');
});

test('markGateBypassed autorise la poursuite dans le navigateur', () => {
  const storage = fakeStorage();
  markGateBypassed(storage);
  const state = readInstallState(storage);
  assert.equal(state.bypassed, true);
  assert.equal(shouldShowInstallGate({ mode: 'invite', bypassed: state.bypassed, settled: true }).block, false);
});
