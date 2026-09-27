import './helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import env from '../src/config/env.js';
import { extractProviderId, sendSms, whatsappErrorMessage, whatsappNumber } from '../src/services/sms.js';

/**
 * Installe WhatsApp le temps d'un test puis restaure la configuration (et le
 * `fetch` global) meme en cas d'echec : aucun fichier de test ne doit laisser
 * l'environnement modifie pour les suivants.
 * @param {Record<string, string>} config
 * @param {() => Promise<void>} run
 */
async function withWhatsApp(config, run) {
  const keys = [
    'SMS_PROVIDER',
    'SMS_FALLBACK_PROVIDER',
    'SMS_SENDER_ID',
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_ID',
    'WHATSAPP_TEMPLATE',
    'WHATSAPP_TEMPLATE_LANG',
    'WHATSAPP_API_VERSION',
    'SMS_HTTP_URL',
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
  const savedFetch = globalThis.fetch;
  Object.assign(env, {
    SMS_PROVIDER: 'whatsapp',
    SMS_FALLBACK_PROVIDER: 'none',
    SMS_SENDER_ID: 'BODOGUI',
    WHATSAPP_TOKEN: 'jeton-de-test',
    WHATSAPP_PHONE_ID: '1234567890',
    WHATSAPP_TEMPLATE: '',
    WHATSAPP_TEMPLATE_LANG: 'fr',
    WHATSAPP_API_VERSION: 'v21.0',
    SMS_HTTP_URL: '',
    ...config,
  });
  try {
    await run();
  } finally {
    Object.assign(env, saved);
    globalThis.fetch = savedFetch;
  }
}

/**
 * Remplace `fetch` par un espion : aucune requete reelle n'est faite vers Meta.
 * Chaque appel est enregistre (URL, en-tetes, corps JSON) et recoit la reponse
 * suivante de la liste (la derniere est repetee si la liste est plus courte).
 * @param {Array<{status?: number, body?: string}>} [responses]
 */
function stubFetch(responses = [{}]) {
  const list = Array.isArray(responses) ? responses : [responses];
  const calls = [];
  let index = 0;
  globalThis.fetch = async (url, options = {}) => {
    const spec = list[Math.min(index, list.length - 1)] || {};
    index += 1;
    // WhatsApp envoie du JSON, la passerelle de secours peut envoyer du texte
    // brut : on conserve le corps tel quel quand ce n'est pas du JSON.
    let payload = null;
    if (options.body) {
      try {
        payload = JSON.parse(options.body);
      } catch {
        payload = options.body;
      }
    }
    calls.push({ url: String(url), headers: options.headers || {}, payload });
    const status = spec.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => spec.body || '{"messages":[{"id":"wamid.TEST"}]}',
    };
  };
  return calls;
}

const OTP_BODY = 'Bodogui : votre code est 12345. Valable 5 minutes.';

test('whatsappNumber ne garde que les chiffres (indicatif pays inclus)', () => {
  assert.equal(whatsappNumber('+235 66 12 34 56'), '23566123456');
  assert.equal(whatsappNumber('235-66-12-34-56'), '23566123456');
  assert.equal(whatsappNumber(undefined), '');
});

test('extractProviderId lit l identifiant de message WhatsApp', () => {
  assert.equal(extractProviderId('{"messages":[{"id":"wamid.HBgN"}]}'), 'wamid.HBgN');
  assert.equal(extractProviderId('reponse non JSON'), undefined);
});

test('whatsappErrorMessage rend l erreur de Meta lisible', () => {
  const message = whatsappErrorMessage('{"error":{"message":"Re-engagement message","code":131047}}');
  assert.match(message, /Re-engagement message/);
  assert.match(message, /131047/);
  assert.equal(whatsappErrorMessage('service indisponible'), 'service indisponible');
});

test('sans modele, le code part en texte libre vers le numero en chiffres', async () => {
  await withWhatsApp({}, async () => {
    const calls = stubFetch();
    const res = await sendSms({ to: '+235 66 12 34 56', body: OTP_BODY, code: '12345' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/1234567890/messages');
    assert.equal(calls[0].headers.Authorization, 'Bearer jeton-de-test');
    assert.equal(calls[0].payload.messaging_product, 'whatsapp');
    assert.equal(calls[0].payload.to, '23566123456');
    assert.equal(calls[0].payload.type, 'text');
    assert.equal(calls[0].payload.text.body, OTP_BODY);
    assert.equal(res.ok, true);
    assert.equal(res.provider, 'whatsapp');
    assert.equal(res.providerId, 'wamid.TEST');
    assert.equal(res.mode, 'text');
  });
});

test('avec WHATSAPP_TEMPLATE, le code part en premier parametre du modele', async () => {
  await withWhatsApp({ WHATSAPP_TEMPLATE: 'code_bodogui', WHATSAPP_TEMPLATE_LANG: 'ar' }, async () => {
    const calls = stubFetch();
    const res = await sendSms({ to: '+23566000000', body: OTP_BODY, code: '12345' });

    assert.equal(calls[0].payload.type, 'template');
    assert.equal(calls[0].payload.template.name, 'code_bodogui');
    assert.deepEqual(calls[0].payload.template.language, { code: 'ar' });
    assert.equal(calls[0].payload.template.components[0].type, 'body');
    assert.equal(calls[0].payload.template.components[0].parameters[0].text, '12345');
    assert.equal(res.mode, 'template');
  });
});

test('une alerte sans code repasse en texte libre malgre le modele', async () => {
  await withWhatsApp({ WHATSAPP_TEMPLATE: 'code_bodogui' }, async () => {
    const calls = stubFetch();
    const res = await sendSms({ to: '+23566000000', body: 'Bodogui : votre annonce est publiee.' });

    assert.equal(calls[0].payload.type, 'text');
    assert.equal(res.mode, 'text');
  });
});

test('WhatsApp incomplet : erreur explicite et aucun appel reseau', async () => {
  await withWhatsApp({ WHATSAPP_TOKEN: '' }, async () => {
    const calls = stubFetch();
    await assert.rejects(
      () => sendSms({ to: '+23566000000', body: OTP_BODY, code: '12345' }),
      (err) => {
        assert.equal(err.code, 'sms_not_configured');
        assert.match(err.message, /WHATSAPP_TOKEN/);
        return true;
      },
    );
    assert.equal(calls.length, 0);
  });
});

test('refus de Meta : erreur de passerelle portant le message du fournisseur', async () => {
  await withWhatsApp({}, async () => {
    stubFetch({ status: 400, body: '{"error":{"message":"Re-engagement message","code":131047}}' });
    await assert.rejects(
      () => sendSms({ to: '+23566000000', body: OTP_BODY, code: '12345' }),
      (err) => {
        assert.equal(err.code, 'sms_provider_error');
        assert.match(err.message, /131047/);
        return true;
      },
    );
  });
});

test('canal de secours : un refus WhatsApp part par SMS', async () => {
  await withWhatsApp({ SMS_FALLBACK_PROVIDER: 'http', SMS_HTTP_URL: 'https://passerelle.test/sms' }, async () => {
    const calls = stubFetch([
      { status: 400, body: '{"error":{"message":"hors fenetre de 24 h","code":131047}}' },
      { status: 200, body: '{"message_id":"sms-1"}' },
    ]);
    const res = await sendSms({ to: '+23566000000', body: OTP_BODY, code: '12345' });

    assert.equal(calls.length, 2, 'le secours doit etre essaye une seule fois');
    assert.match(calls[0].url, /graph\.facebook\.com/);
    assert.equal(calls[1].url, 'https://passerelle.test/sms');
    assert.equal(res.provider, 'http');
    assert.equal(res.fallback, true);
    assert.equal(res.primaryFailed, 'whatsapp');
    assert.equal(res.providerId, 'sms-1');
  });
});

test('sans canal de secours, l echec remonte tel quel', async () => {
  await withWhatsApp({}, async () => {
    stubFetch({ status: 401, body: '{"error":{"message":"Invalid OAuth access token","code":190}}' });
    await assert.rejects(
      () => sendSms({ to: '+23566000000', body: OTP_BODY, code: '12345' }),
      (err) => {
        assert.equal(err.code, 'sms_provider_error');
        assert.match(err.message, /Invalid OAuth access token/);
        return true;
      },
    );
  });
});
