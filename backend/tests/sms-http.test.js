import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import env from '../src/config/env.js';
import { extractProviderId, parseHttpHeaders, renderHttpTemplate, sendSms } from '../src/services/sms.js';

/**
 * Installe temporairement une passerelle SMS HTTP et restaure la configuration
 * (et le fetch global) a la fin, meme en cas d'echec : les tests ne doivent pas
 * laisser l'environnement modifie pour les fichiers suivants.
 * @param {Record<string, string>} config
 * @param {() => Promise<void>} run
 */
async function withHttpSms(config, run) {
  const keys = ['SMS_PROVIDER', 'SMS_SENDER_ID', 'SMS_HTTP_URL', 'SMS_HTTP_METHOD', 'SMS_HTTP_HEADERS', 'SMS_HTTP_BODY'];
  const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
  const savedFetch = globalThis.fetch;
  Object.assign(env, {
    SMS_PROVIDER: 'http',
    SMS_SENDER_ID: 'BODOGUI',
    SMS_HTTP_URL: '',
    SMS_HTTP_METHOD: 'POST',
    SMS_HTTP_HEADERS: '',
    SMS_HTTP_BODY: '',
    ...config,
  });
  try {
    await run();
  } finally {
    Object.assign(env, saved);
    globalThis.fetch = savedFetch;
  }
}

/** Reponse HTTP minimale, comme celle utilisee par `fetch`. */
const httpResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test('renderHttpTemplate echappe les valeurs pour rester un JSON valide', () => {
  const body = renderHttpTemplate(
    '{"to":"{{to}}","sms":"{{body}}"}',
    { to: '+23566000000', body: 'Bodogui : code 12345, ne dites pas "bonjour" / merci' },
    'json',
  );
  assert.deepEqual(JSON.parse(body), { to: '+23566000000', sms: 'Bodogui : code 12345, ne dites pas "bonjour" / merci' });
});

test('renderHttpTemplate encode les valeurs pour un formulaire', () => {
  const form = renderHttpTemplate(
    'api_key={{api_key}}&to={{to_digits}}&sms={{body}}',
    { api_key: 'cle avec espace', to_digits: '23566000000', body: 'Code 12345' },
    'form',
  );
  assert.equal(form, 'api_key=cle%20avec%20espace&to=23566000000&sms=Code%2012345');
});

test('renderHttpTemplate laisse les jetons inconnus tels quels', () => {
  assert.equal(renderHttpTemplate('{{inconnu}}', {}, 'json'), '{{inconnu}}');
  assert.equal(renderHttpTemplate(null, {}, 'json'), '');
});

test('parseHttpHeaders remplace les jetons et refuse un JSON invalide', () => {
  assert.deepEqual(parseHttpHeaders('{"Authorization":"Bearer {{api_key}}"}', { api_key: 'abc' }), {
    Authorization: 'Bearer abc',
  });
  assert.deepEqual(parseHttpHeaders('', {}), {});
  assert.throws(() => parseHttpHeaders('pas du json', {}), /objet JSON/);
});

test('extractProviderId recupere l\'identifiant du message quand il existe', () => {
  assert.equal(extractProviderId('{"message_id":"m-1"}'), 'm-1');
  assert.equal(extractProviderId('{"data":{"id":"d-1"}}'), 'd-1');
  assert.equal(extractProviderId('{"sid":"SM1"}'), 'SM1');
  assert.equal(extractProviderId('reponse en texte libre'), undefined);
});

test('sendSms via passerelle HTTP envoie le corps configure et lit l\'identifiant', async () => {
  const calls = [];
  await withHttpSms(
    {
      SMS_HTTP_URL: 'https://sms.example.td/api/send',
      SMS_HTTP_HEADERS: '{"Authorization":"App cle-secrete","Content-Type":"application/json"}',
      SMS_HTTP_BODY: '{"to":"{{to}}","from":"{{from}}","sms":"{{body}}"}',
    },
    async () => {
      globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return httpResponse(200, '{"message_id":"abc123"}');
      };
      const res = await sendSms({ to: '+23566000000', body: 'Bodogui : votre code est 12345.' });
      assert.equal(res.ok, true);
      assert.equal(res.provider, 'http');
      assert.equal(res.providerId, 'abc123');
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://sms.example.td/api/send');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'App cle-secrete');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    to: '+23566000000',
    from: 'BODOGUI',
    sms: 'Bodogui : votre code est 12345.',
  });
});

test('sendSms via passerelle HTTP en GET place le modele dans l\'URL', async () => {
  const calls = [];
  await withHttpSms(
    {
      SMS_HTTP_URL: 'https://sms.example.td/send',
      SMS_HTTP_METHOD: 'GET',
      SMS_HTTP_BODY: 'to={{to_digits}}&message={{body}}',
    },
    async () => {
      globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return httpResponse(200, 'OK');
      };
      const res = await sendSms({ to: '+23566000000', body: 'Code 12345' });
      assert.equal(res.ok, true);
      assert.equal(res.providerId, undefined);
    },
  );
  assert.equal(calls[0].url, 'https://sms.example.td/send?to=23566000000&message=Code%2012345');
  assert.equal(calls[0].options.body, undefined);
});

test('sendSms remonte une erreur de passerelle (HTTP 500) sans bloquer l\'API', async () => {
  await withHttpSms({ SMS_HTTP_URL: 'https://sms.example.td/api/send' }, async () => {
    globalThis.fetch = async () => httpResponse(500, 'quota depasse');
    await assert.rejects(() => sendSms({ to: '+23566000000', body: 'Code 12345' }), /HTTP 500 quota depasse/);
  });
});

test('sendSms refuse une passerelle HTTP sans URL (configuration incomplete)', async () => {
  await withHttpSms({}, async () => {
    await assert.rejects(() => sendSms({ to: '+23566000000', body: 'Code 12345' }), /SMS_HTTP_URL/);
  });
});
