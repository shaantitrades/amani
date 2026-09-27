import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disableScrollRestoration,
  scrollPageToTop,
  shouldResetScroll,
} from '../src/lib/scroll.js';

test('on repart du haut des qu on change d ecran', () => {
  assert.equal(shouldResetScroll('/home', '/group/12'), true);
  assert.equal(shouldResetScroll('/group/12', '/home'), true);
  assert.equal(shouldResetScroll('/groups', '/group/12'), true);
});

test('aucune remontee inutile sur le meme ecran', () => {
  assert.equal(shouldResetScroll('/group/12', '/group/12'), false);
  // Parametre et slash final ne changent pas d'ecran
  assert.equal(shouldResetScroll('/group/12/', '/group/12'), false);
  assert.equal(shouldResetScroll('/group/12?tab=ads', '/group/12'), false);
});

test('premier affichage : la page repart du haut', () => {
  assert.equal(shouldResetScroll(null, '/home'), true);
  assert.equal(shouldResetScroll(undefined, '/home'), true);
  assert.equal(shouldResetScroll(null, undefined), true);
});

test('scrollPageToTop pilote le defilement de la fenetre', () => {
  const calls = [];
  const scope = { scrollTo: (options) => calls.push(options) };
  assert.equal(scrollPageToTop(scope), true);
  assert.deepEqual(calls, [{ top: 0, left: 0, behavior: 'auto' }]);
});

test('scrollPageToTop ne casse rien hors navigateur', () => {
  assert.equal(scrollPageToTop(null), false);
  assert.equal(scrollPageToTop({}), false);
  assert.equal(scrollPageToTop({ scrollTo: 'pas une fonction' }), false);
});

test('la restauration automatique du defilement est desactivee', () => {
  const scope = { history: {} };
  assert.equal(disableScrollRestoration(scope), true);
  assert.equal(scope.history.scrollRestoration, 'manual');
});

test('disableScrollRestoration resiste a une propriete en lecture seule', () => {
  const scope = {
    history: {
      get scrollRestoration() {
        return 'auto';
      },
      set scrollRestoration(_value) {
        throw new Error('lecture seule');
      },
    },
  };
  assert.equal(disableScrollRestoration(scope), false);
  assert.equal(disableScrollRestoration(null), false);
  assert.equal(disableScrollRestoration({}), false);
});
