import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startupHint } from '../src/db/migrate.js';

test('mot de passe refuse : l\'aide renvoie vers POSTGRES_PASSWORD et le volume db-data', () => {
  const hint = startupHint(new Error('password authentication failed for user "bodogui"'));
  assert.match(hint, /volume db-data/);
  assert.match(hint, /POSTGRES_PASSWORD/);
});

test('mot de passe absent dans DATABASE_URL : meme aide', () => {
  const hint = startupHint(
    new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string'),
  );
  assert.match(hint, /mot de passe/i);
});

test('Postgres injoignable : l\'aide parle du service db', () => {
  const hint = startupHint(new Error('connect ECONNREFUSED 172.18.0.3:5432'));
  assert.match(hint, /injoignable/);
  assert.match(hint, /db:5432/);
});

test('DATABASE_URL invalide : l\'aide recommande un mot de passe hexadecimal', () => {
  const hint = startupHint(new Error('Invalid URL'));
  assert.match(hint, /hexadecimal/);
  assert.match(hint, /openssl rand -hex 24/);
});

test('une vraie erreur SQL ne declenche aucune aide trompeuse', () => {
  assert.equal(startupHint(new Error('column "district_id" does not exist')), null);
  assert.equal(startupHint(undefined), null);
});
