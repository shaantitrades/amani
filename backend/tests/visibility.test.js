import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeBanCondition, buildAdFilters, isBanExpired } from '../src/lib/visibility.js';
import { paged, readPage } from '../src/lib/pagination.js';

test('buildAdFilters construit les clauses et les parametres dans l\'ordre', () => {
  const { where, params, nextIndex } = buildAdFilters({
    categoryId: 'cat-1',
    districtId: 'dist-1',
    kind: 'sell',
    minPrice: 1000,
    maxPrice: 500000,
    q: 'vache',
  });
  assert.equal(params.length, 6);
  assert.equal(nextIndex, 7);
  assert.ok(where.some((w) => w.includes('a.category_id = $1')));
  assert.ok(where.some((w) => w.includes('a.district_id = $2')));
  assert.ok(where.some((w) => w.includes('a.kind = $3')));
  assert.ok(where.some((w) => w.includes('a.price_amount >= $4')));
  assert.ok(where.some((w) => w.includes('a.price_amount <= $5')));
  assert.ok(where.some((w) => w.includes('ILIKE $6')));
  assert.equal(params[5], '%vache%');
});

test('buildAdFilters retourne un filtre vide sans criteres', () => {
  const { where, params } = buildAdFilters();
  assert.deepEqual(where, []);
  assert.deepEqual(params, []);
});

test('buildAdFilters ignore les prix nuls ou indefinis', () => {
  const { where } = buildAdFilters({ minPrice: undefined, maxPrice: null });
  assert.deepEqual(where, []);
});

test('activeBanCondition masque les bans expires', () => {
  const sql = activeBanCondition('u');
  assert.match(sql, /u\.banned_at IS NOT NULL/);
  assert.match(sql, /u\.ban_expires_at IS NULL OR u\.ban_expires_at > now\(\)/);
});

test('isBanExpired gere null, date passee, date future et levee', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  assert.equal(isBanExpired(null, now), true);
  assert.equal(isBanExpired({ lifted_at: new Date(), expires_at: null }, now), true);
  assert.equal(isBanExpired({ expires_at: null }, now), false); // ban definitif
  assert.equal(isBanExpired({ expires_at: '2025-12-01T00:00:00Z' }, now), true);
  assert.equal(isBanExpired({ expires_at: '2026-06-01T00:00:00Z' }, now), false);
});

test('readPage borne la pagination', () => {
  assert.deepEqual(readPage({ limit: '10', offset: '20' }), { limit: 10, offset: 20 });
  assert.deepEqual(readPage({ limit: '9999' }), { limit: 20, offset: 0 });
  assert.deepEqual(readPage({}), { limit: 20, offset: 0 });
});

test('paged calcule le prochain offset', () => {
  const res = paged([1, 2, 3], { limit: 3, offset: 0, total: 10 });
  assert.equal(res.page.count, 3);
  assert.equal(res.page.nextOffset, 3);
  const last = paged([1], { limit: 3, offset: 9, total: 10 });
  assert.equal(last.page.nextOffset, null);
  const unknown = paged([1], { limit: 3, offset: 0 });
  assert.equal(unknown.page.nextOffset, null);
});
