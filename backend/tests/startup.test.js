import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDatabaseUrl } from '../src/config/env.js';
import { startDiagnosticServer } from '../src/lib/diagnostic-server.js';
import { setMigrationFailure, setMigrationsReady, startupState } from '../src/lib/startup-state.js';
import { configHint, hintFor, startupHint } from '../src/lib/startup-hint.js';

/** Journal silencieux : le banniere du serveur de diagnostic polluerait la sortie. */
const silent = { error() {}, log() {}, warn() {} };

test('configuration invalide : l\'aide cite la variable fautive et la documentation', () => {
  const err = Object.assign(new Error('Configuration invalide (1 variable(s) en cause)'), {
    configIssues: [{ path: ['JWT_SECRET'], message: 'JWT_SECRET doit faire au moins 16 caracteres' }],
  });
  const hint = hintFor(err);
  assert.match(hint, /JWT_SECRET doit faire au moins 16 caracteres/);
  assert.match(hint, /docs\/ENVIRONMENT\.md/);
});

test('hintFor privilegie la configuration, sinon l\'aide Postgres', () => {
  assert.match(hintFor(new Error('password authentication failed for user "bodogui"')), /POSTGRES_PASSWORD/);
});

test('hintFor renvoie toujours une aide exploitable', () => {
  assert.match(hintFor(new Error('boum inconnu')), /DATABASE_URL/);
  assert.match(hintFor(undefined), /docs\/ENVIRONMENT\.md/);
  assert.match(configHint(), /Configuration invalide/);
});

test('hote introuvable : l\'aide oriente vers les variables PG* et un mot de passe hexadecimal', () => {
  const hint = startupHint(new Error('getaddrinfo ENOTFOUND kQ8f'));
  assert.match(hint, /PG\*/);
  assert.match(hint, /hex/);
});

test('le serveur de diagnostic publie la cause en JSON (503) au lieu d\'un 502 opaque', async () => {
  const server = startDiagnosticServer({
    port: 0,
    error: 'password authentication failed for user "bodogui"',
    hint: 'aide de demarrage',
    log: silent,
  });
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/healthz`);
    assert.equal(res.status, 503);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const body = await res.json();
    assert.equal(body.status, 'startup_failed');
    assert.match(body.error, /password authentication failed/);
    assert.equal(body.hint, 'aide de demarrage');
    assert.equal(body.docs, 'docs/ENVIRONMENT.md');

    // La sonde Coolify repond aussi (503 : le conteneur reste vivant et lisible)
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('etat de demarrage : la cause est exposee a la sonde puis effacee apres succes', () => {
  setMigrationFailure(new Error('migration en echec'), 'aide');
  const failed = startupState();
  assert.equal(failed.migrations, 'failed');
  assert.match(failed.error, /migration en echec/);
  assert.equal(failed.hint, 'aide');

  setMigrationsReady(4);
  const ready = startupState();
  assert.equal(ready.migrations, 'ok');
  assert.equal(ready.applied, 4);
  assert.equal(ready.error, null);
  assert.equal(ready.hint, null);
});

test('variables PG* : le mot de passe est encode pour l\'URL', () => {
  const url = buildDatabaseUrl({
    PGUSER: 'bodogui',
    PGPASSWORD: 'a+b/c=',
    PGHOST: 'db',
    PGPORT: '5432',
    PGDATABASE: 'bodogui',
  });
  assert.equal(url, 'postgres://bodogui:a%2Bb%2Fc%3D@db:5432/bodogui');
  // Sans encodage, le / couperait l'URL : l'hote deviendrait une partie du mot de passe.
  assert.equal(new URL(url).hostname, 'db');
  assert.equal(new URL(url).port, '5432');
});

test('DATABASE_URL fournie reste prioritaire, valeurs par defaut sinon', () => {
  assert.equal(
    buildDatabaseUrl({ DATABASE_URL: 'postgres://x:y@z:5432/w', PGHOST: 'db' }),
    'postgres://x:y@z:5432/w',
  );
  assert.equal(buildDatabaseUrl({}), 'postgres://bodogui@localhost:5432/bodogui');
});
