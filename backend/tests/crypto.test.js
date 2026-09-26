import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOtp, hashOtp, safeEqual, sha256, randomToken, verifyOtp } from '../src/lib/crypto.js';

test('genere un code OTP numerique de la bonne longueur', () => {
  const code = generateOtp(5);
  assert.equal(code.length, 5);
  assert.match(code, /^[0-9]{5}$/);
});

test('le code OTP ne depend pas seulement du hasard (bornes respectees)', () => {
  const codes = Array.from({ length: 200 }, () => generateOtp(5, () => 9));
  assert.ok(codes.every((c) => c === '99999'));
  const zeros = generateOtp(4, () => 0);
  assert.equal(zeros, '0000');
});

test('hashOtp est deterministe et lie le code au numero', () => {
  const h1 = hashOtp('12345', '+23566123456');
  const h2 = hashOtp('12345', '+23566123456');
  const h3 = hashOtp('12345', '+23566123457');
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.equal(h1.length, 64); // HMAC-SHA256 en hexadecimal
});

test('verifyOtp accepte le bon code et refuse les autres', () => {
  const hash = hashOtp('54321', '+23566000001');
  assert.equal(verifyOtp('54321', '+23566000001', hash), true);
  assert.equal(verifyOtp('12345', '+23566000001', hash), false);
  assert.equal(verifyOtp('54321', '+23566000002', hash), false);
});

test('safeEqual resiste aux tailles differentes', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
  assert.equal(safeEqual(undefined, 'a'), false);
});

test('sha256 et randomToken produisent des valeurs uniques', () => {
  assert.equal(sha256('bodogui'), sha256('bodogui'));
  assert.notEqual(randomToken(), randomToken());
  assert.ok(randomToken(48).length >= 60);
});
