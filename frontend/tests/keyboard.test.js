import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYBOARD_MARGIN, keyboardScrollDelta, keepFieldVisible, visibleViewport } from '../src/lib/keyboard.js';

/** Rectangle minimal, comme celui renvoye par getBoundingClientRect. */
const rect = (top, bottom) => ({ top, bottom });

test('keyboardScrollDelta ne bouge rien quand le champ et le bouton sont visibles', () => {
  assert.equal(
    keyboardScrollDelta({ field: rect(100, 152), action: rect(100, 212), safeTop: 64, visibleBottom: 600 }),
    0,
  );
});

test('keyboardScrollDelta remonte le champ cache sous la barre du haut', () => {
  // Cas reel : le navigateur a ramene le champ tout en haut, derriere la barre
  // collante -> le champ doit redescendre juste sous la barre.
  const delta = keyboardScrollDelta({ field: rect(20, 72), action: rect(20, 132), safeTop: 64, visibleBottom: 400 });
  assert.equal(delta, -(64 + KEYBOARD_MARGIN - 20));
  assert.equal(20 - delta, 64 + KEYBOARD_MARGIN);
});

test('keyboardScrollDelta descend juste ce qu\'il faut pour degager le bouton du clavier', () => {
  // Clavier ouvert : seuls 200 px restent visibles, le bas du bouton (212) est
  // coupe -> on descend de 20 px (positif = on descend, le contenu remonte).
  const delta = keyboardScrollDelta({ field: rect(100, 152), action: rect(100, 212), safeTop: 64, visibleBottom: 200 });
  assert.equal(delta, 212 + KEYBOARD_MARGIN - 200);
  assert.equal(212 - delta, 200 - KEYBOARD_MARGIN); // bas du bouton juste au-dessus du clavier
});

test('keyboardScrollDelta ne descend jamais au point de cacher le champ', () => {
  // Zone visible minuscule (petit ecran + gros clavier) : mieux vaut garder le
  // champ lisible que le bouton.
  const delta = keyboardScrollDelta({ field: rect(80, 132), action: rect(80, 192), safeTop: 64, visibleBottom: 140 });
  assert.equal(delta, 8);
  assert.equal(80 - delta, 64 + KEYBOARD_MARGIN);
});

test('keyboardScrollDelta reste inerte sans champ ou sans zone visible', () => {
  assert.equal(keyboardScrollDelta({}), 0);
  assert.equal(keyboardScrollDelta({ field: rect(10, 20), visibleBottom: 0 }), 0);
});

test('visibleViewport suit le clavier quand visualViewport existe', () => {
  assert.deepEqual(visibleViewport({ visualViewport: { height: 400, offsetTop: 0 }, innerHeight: 800 }), {
    top: 0,
    bottom: 400,
  });
  assert.deepEqual(visibleViewport({ visualViewport: { height: 400, offsetTop: 30 }, innerHeight: 800 }), {
    top: 30,
    bottom: 430,
  });
  // Repli des anciens navigateurs : tout l'ecran est considere visible.
  assert.deepEqual(visibleViewport({ innerHeight: 700 }), { top: 0, bottom: 700 });
  assert.deepEqual(visibleViewport(null), { top: 0, bottom: 0 });
});

test('keepFieldVisible applique le defilement calcule (barre du haut lue dans le DOM)', () => {
  const calls = [];
  const win = {
    visualViewport: { height: 200, offsetTop: 0 },
    innerHeight: 800,
    scrollBy: (x, y) => calls.push([x, y]),
    document: { querySelector: () => ({ getBoundingClientRect: () => rect(0, 64) }) },
  };
  const field = { getBoundingClientRect: () => rect(100, 152) };
  const action = { getBoundingClientRect: () => rect(100, 212) };

  assert.equal(keepFieldVisible({ field, action, win }), 20);
  assert.deepEqual(calls, [[0, 20]]);
});

test('keepFieldVisible ne touche a rien sans champ (rendu sans DOM)', () => {
  const win = { innerHeight: 800, scrollBy: () => assert.fail('ne doit pas defiler') };
  assert.equal(keepFieldVisible({ field: null, win }), 0);
});
