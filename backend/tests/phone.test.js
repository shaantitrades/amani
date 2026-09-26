import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, dialable, formatPhone, isValidPhone, normalizePhone, parsePhoneList } from '../src/lib/phone.js';

test('normalise un numero tchadien local (8 chiffres)', () => {
  const r = normalizePhone('66123456');
  assert.equal(r.ok, true);
  assert.equal(r.e164, '+23566123456');
  assert.equal(r.country, 'TD');
});

test('accepte les separateurs, parentheses et zero initial', () => {
  assert.equal(normalizePhone('66 12 34 56').e164, '+23566123456');
  assert.equal(normalizePhone('66-12-34-56').e164, '+23566123456');
  assert.equal(normalizePhone('(66) 12 34 56').e164, '+23566123456');
  assert.equal(normalizePhone('066123456').e164, '+23566123456');
});

test('accepte les formats internationaux', () => {
  assert.equal(normalizePhone('+235 66 12 34 56').e164, '+23566123456');
  assert.equal(normalizePhone('0023566123456').e164, '+23566123456');
  assert.equal(normalizePhone('23566123456').e164, '+23566123456');
  assert.equal(normalizePhone('+237699887766').country, 'CM');
});

test('rejette les numeros invalides', () => {
  assert.equal(normalizePhone('').ok, false);
  assert.equal(normalizePhone('123').ok, false);
  assert.equal(normalizePhone('12345678901234567890').ok, false);
  assert.equal(normalizePhone(null).ok, false);
  assert.equal(normalizePhone('6612345').ok, false);
  assert.equal(normalizePhone('6612345').error, 'phone_invalid');
});

test('isValidPhone et dialable', () => {
  assert.equal(isValidPhone('66123456'), true);
  assert.equal(isValidPhone('6612345'), false);
  assert.equal(dialable('+235 66 12 34 56'), '+23566123456');
});

test('parsePhoneList normalise, filtre et dedoublonne (numeros de test)', () => {
  assert.deepEqual(parsePhoneList('+235 66 00 00 00, 66123456, +23566000000'), ['+23566000000', '+23566123456']);
  assert.deepEqual(parsePhoneList('0023566000000'), ['+23566000000']);
  assert.deepEqual(parsePhoneList(''), []);
  assert.deepEqual(parsePhoneList('abc, 12'), [], 'les entrees invalides sont ignorees');
  assert.deepEqual(parsePhoneList(undefined), []);
});

test('formate un numero lisible', () => {
  assert.equal(formatPhone('+23566123456'), '+235 66 12 34 56');
  assert.equal(formatPhone('+237699887766'), '+237 699 887 766');
});

test('la table des pays contient le Tchad en premier (marche pilote)', () => {
  assert.equal(COUNTRIES[0].code, 'TD');
  assert.equal(COUNTRIES[0].dial, '235');
  assert.equal(COUNTRIES[0].digits, 8);
});
