import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_FEED_LIMIT, homeFeedQuery } from '../src/lib/feed.js';

/** Lit les parametres de la requete (l'ordre des cles n'a pas d'importance). */
function paramsOf(query) {
  assert.match(query, /^\/ads\?/, 'la requete doit viser /ads');
  return new URLSearchParams(query.split('?')[1]);
}

test('sans quartier : le fil d\'accueil demande les dernieres annonces', () => {
  const params = paramsOf(homeFeedQuery(null));
  assert.equal(params.get('limit'), String(HOME_FEED_LIMIT));
  assert.equal(params.get('district_id'), null);
  assert.equal(params.get('include_unknown'), null);

  assert.equal(paramsOf(homeFeedQuery(undefined)).get('limit'), String(HOME_FEED_LIMIT));
  assert.equal(paramsOf(homeFeedQuery({ district_id: null })).get('district_id'), null);
});

test('avec quartier : le quartier est un repere, pas un filtre strict', () => {
  const params = paramsOf(homeFeedQuery({ district_id: 'quartier-1' }));
  assert.equal(params.get('district_id'), 'quartier-1');
  assert.equal(
    params.get('include_unknown'),
    'true',
    'les annonces sans quartier doivent rester visibles (majorite des vendeurs)',
  );
  assert.equal(params.get('limit'), String(HOME_FEED_LIMIT));
});

test('la taille du fil reste reglable (tests, petits ecrans)', () => {
  const params = paramsOf(homeFeedQuery({ district_id: 'quartier-1' }, 2));
  assert.equal(params.get('limit'), '2');
  assert.equal(params.get('district_id'), 'quartier-1');
  assert.equal(params.get('include_unknown'), 'true');
});
