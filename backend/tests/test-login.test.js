import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOtpCode } from '../src/services/otp.js';

/**
 * Connexion de recette : un numero autorise (TEST_LOGIN_PHONES) recoit un code
 * fixe (TEST_LOGIN_CODE) sans passer par la passerelle SMS, ce qui permet de
 * tester le site deploye avant l'ouverture du compte Africa's Talking.
 */
const TEST_PHONES = ['+23566000000', '+23566123456'];
const TEST_CODE = '12345';

/** Meme regle que dans la configuration : 4 a 8 chiffres. */
const TEST_LOGIN_CODE_PATTERN = /^\d{4,8}$/;

test('un numero de test recoit le code fixe, sans SMS', () => {
  const result = resolveOtpCode('+23566000000', { testPhones: TEST_PHONES, testCode: TEST_CODE });
  assert.equal(result.code, TEST_CODE);
  assert.equal(result.simulated, true);
  assert.equal(result.phone, '+23566000000');
});

test('le numero de test est reconnu quel que soit le format saisi', () => {
  assert.equal(resolveOtpCode('66000000', { testPhones: TEST_PHONES, testCode: TEST_CODE }).simulated, true);
  assert.equal(resolveOtpCode('+235 66 00 00 00', { testPhones: TEST_PHONES, testCode: TEST_CODE }).simulated, true);
});

test('les autres numeros gardent un code aleatoire a 5 chiffres', () => {
  const result = resolveOtpCode('+23566999999', { testPhones: TEST_PHONES, testCode: TEST_CODE });
  assert.equal(result.simulated, false);
  assert.match(result.code, /^\d{5}$/);
  assert.notEqual(result.code, TEST_CODE);
});

test('la connexion de test est inactive si la liste ou le code manque', () => {
  assert.equal(resolveOtpCode('+23566000000', { testPhones: [], testCode: TEST_CODE }).simulated, false);
  assert.equal(resolveOtpCode('+23566000000', { testPhones: TEST_PHONES, testCode: '' }).simulated, false);
});

test('un code de test mal forme est ignore (jamais de code trivial)', () => {
  // Une faute de frappe dans TEST_LOGIN_CODE (Coolify) ne doit ni casser l'API,
  // ni accepter un code devinable : on retombe sur un code aleatoire.
  for (const bad of ['abc', '123', '123456789', '12 345', 'code123']) {
    assert.equal(TEST_LOGIN_CODE_PATTERN.test(bad), false, `${bad} doit etre refuse`);
    const result = resolveOtpCode('+23566000000', { testPhones: TEST_PHONES, testCode: bad });
    assert.equal(result.simulated, false);
    assert.match(result.code, /^\d{5}$/);
  }
  // Bornes acceptees : 4 et 8 chiffres.
  assert.equal(resolveOtpCode('+23566000000', { testPhones: TEST_PHONES, testCode: '1234' }).simulated, true);
  assert.equal(resolveOtpCode('+23566000000', { testPhones: TEST_PHONES, testCode: '12345678' }).simulated, true);
});
