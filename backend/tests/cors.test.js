import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed } from '../src/lib/cors.js';

test('sans en-tete Origin (curl, application mobile) la requete passe', () => {
  assert.equal(isOriginAllowed(undefined, []), true);
  assert.equal(isOriginAllowed(undefined, ['https://bodogui.com']), true);
});

test('CORS_ORIGINS non configure (liste vide) ne bloque pas le site', () => {
  assert.equal(isOriginAllowed('http://exemple.sslip.io', []), true);
  assert.equal(isOriginAllowed('http://exemple.sslip.io', undefined), true);
});

test('liste configuree : seules les origines declarees passent', () => {
  const allowed = ['https://bodogui.com', 'http://exemple.sslip.io'];
  assert.equal(isOriginAllowed('https://bodogui.com', allowed), true);
  assert.equal(isOriginAllowed('http://exemple.sslip.io', allowed), true);
  assert.equal(isOriginAllowed('https://site-pirate.example', allowed), false);
});

test('CORS_ORIGINS=* autorise toutes les origines', () => {
  assert.equal(isOriginAllowed('https://nimporte-quoi.example', ['*']), true);
});

test('les espaces de CORS_ORIGINS sont ignores (decoupage env)', () => {
  // Reproduit le decoupage fait dans config/env.js.
  const corsOrigins = ' https://bodogui.com , http://exemple.sslip.io ,'.split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(corsOrigins, ['https://bodogui.com', 'http://exemple.sslip.io']);
  assert.equal(isOriginAllowed('https://bodogui.com', corsOrigins), true);
});
