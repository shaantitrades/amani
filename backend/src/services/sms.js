import env from '../config/env.js';
import logger from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

/**
 * Modeles de SMS multilingues et courts (un SMS coute cher, un seul suffit).
 * Les langues non latines sont translitterees : la plupart des feature phones
 * du Sahel n'affichent pas correctement l'arabe en SMS.
 */
export const SMS_TEMPLATES = {
  otp: {
    fr: ({ code, app }) => `${app}: votre code est ${code}. Valable ${'{{ttl}}'} minutes. Ne le partagez avec personne.`,
    ar: ({ code, app }) => `${app}: code ${code}. Valide {{ttl}} min. Ne le donnez a personne.`,
    ff: ({ code, app }) => `${app}: kod maa ko woni ${code}. Nde himo {{ttl}} minu. Wata a yeewtu nde.`,
  },
  ad_published: {
    fr: ({ app }) => `${app}: votre annonce est publiee. Vous recevrez un SMS si quelqu'un est interesse.`,
    ar: ({ app }) => `${app}: annonce bi publiye. SMS so woni interested.`,
    ff: ({ app }) => `${app}: njoftal maa yaltii. SMS wartoto so neɗɗo yiɗi.`,
  },
  ad_interest: {
    fr: ({ app, category }) => `${app}: quelqu'un est interesse par votre annonce "${category}". Ouvrez l'application pour voir.`,
    ar: ({ app, category }) => `${app}: neɗɗo yiɗi annonce maa "${category}". Uddu app ngam yiyde.`,
    ff: ({ app, category }) => `${app}: neɗɗo yiɗi annonce maa "${category}". Uddit app ngam yiyde.`,
  },
  group_post: {
    fr: ({ app, group }) => `${app}: nouvelle annonce dans le groupe "${group}". Ouvrez l'application.`,
    ar: ({ app, group }) => `${app}: annonce keso e groupe "${group}". Uddit app.`,
    ff: ({ app, group }) => `${app}: annonce keso to groupe "${group}". Uddit app.`,
  },
  ban: {
    fr: ({ app }) => `${app}: votre compte a ete suspendu. Contactez le support.`,
    ar: ({ app }) => `${app}: compte maa nde sudu. Yewtu support.`,
    ff: ({ app }) => `${app}: compte maa uddaama. Yewtu support.`,
  },
  safety: {
    fr: ({ app }) => `${app}: ne payez jamais avant d'avoir vu le produit. Rencontrez-vous dans un lieu public.`,
    ar: ({ app }) => `${app}: wata a yoɓu ado yiide produkt. Haɓde e nokku yimɓe.`,
    ff: ({ app }) => `${app}: wata a njoɓu ado yiide ko soodataa. Keddondiree e nokku yimɓe.`,
  },
};

export function renderTemplate(kind, language = 'fr', vars = {}) {
  const byLang = SMS_TEMPLATES[kind];
  if (!byLang) throw new AppError(500, 'unknown_sms_template', `Modele SMS inconnu : ${kind}`);
  const render = byLang[language] || byLang.fr;
  return render({ app: env.APP_NAME, ...vars }).replace(/\s+/g, ' ').trim();
}

/** Decompose un numero E.164 en { dial, local } puis chiffres pour la passerelle. */
function toGatewayNumber(e164) {
  return String(e164 || '').replace(/[^\d+]/g, '');
}

/** Numero au format attendu par l'API WhatsApp : chiffres seuls (`23566000000`). */
export function whatsappNumber(e164) {
  return String(e164 || '').replace(/\D/g, '');
}

async function sendViaConsole({ to, body }) {
  logger.info({ to, body, provider: 'console' }, 'SMS (mode console - non envoye)');
  return { ok: true, provider: 'console', providerId: `console-${Date.now()}`, simulated: true };
}

async function sendViaAfricaTalking({ to, body }) {
  if (!env.AFRICASTALKING_USERNAME || !env.AFRICASTALKING_API_KEY) {
    throw new AppError(500, 'sms_not_configured', "Africa's Talking n'est pas configure");
  }
  const params = new URLSearchParams({
    username: env.AFRICASTALKING_USERNAME,
    to: toGatewayNumber(to),
    message: body,
    from: env.SMS_SENDER_ID,
  });
  const res = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      apiKey: env.AFRICASTALKING_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params,
  });
  const data = await res.json().catch(() => ({}));
  const recipient = data?.SMSMessageData?.Recipients?.[0];
  if (!res.ok || (recipient && recipient.status !== 'Success')) {
    throw new AppError(502, 'sms_provider_error', recipient?.status || `HTTP ${res.status}`);
  }
  return { ok: true, provider: 'africastalking', providerId: recipient?.messageId };
}

async function sendViaTwilio({ to, body }) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new AppError(500, 'sms_not_configured', 'Twilio n\'est pas configure');
  }
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: toGatewayNumber(to), From: env.TWILIO_FROM, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(502, 'sms_provider_error', data?.message || `HTTP ${res.status}`);
  return { ok: true, provider: 'twilio', providerId: data.sid };
}

/** Valeurs remplacables dans un modele HTTP (`{{to}}`, `{{body}}`...). */
export function httpTemplateValues({ to, body }) {
  const gateway = toGatewayNumber(to);
  return {
    to: gateway,
    to_digits: gateway.replace(/\D/g, ''),
    body,
    from: env.SMS_SENDER_ID,
    app: env.APP_NAME,
  };
}

/**
 * Remplit un modele HTTP en ECHAPPANT les valeurs selon le format annonce par
 * `Content-Type` :
 *  - `json` : echappement JSON (guillemets, accents, sauts de ligne) pour que le
 *    corps reste un JSON valide, meme avec un texte libre ;
 *  - `form` : encodage URL (application/x-www-form-urlencoded) ;
 *  - `text` : valeur brute (en-tetes HTTP).
 * Un jeton inconnu est laisse tel quel : la passerelle signalera l'erreur au
 * premier envoi, sans casser le reste de l'application.
 * Fonction pure, testable sans reseau.
 * @param {string} template
 * @param {Record<string, string>} values
 * @param {'json'|'form'|'text'} [format]
 * @returns {string}
 */
export function renderHttpTemplate(template, values, format = 'json') {
  const escape = (value) => {
    const text = String(value === undefined || value === null ? '' : value);
    if (format === 'json') return JSON.stringify(text).slice(1, -1);
    if (format === 'form') return encodeURIComponent(text);
    return text;
  };
  return String(template === undefined || template === null ? '' : template).replace(
    /\{\{\s*([a-z_]+)\s*\}\}/gi,
    (match, key) => {
      const name = String(key).toLowerCase();
      return Object.prototype.hasOwnProperty.call(values, name) ? escape(values[name]) : match;
    },
  );
}

/**
 * En-tetes HTTP personnalises : objet JSON (les valeurs peuvent contenir des
 * jetons, par exemple `{"Authorization":"Bearer {{api_key}}"}`).
 * @param {string} raw
 * @param {Record<string, string>} values
 * @returns {Record<string, string>}
 */
export function parseHttpHeaders(raw, values) {
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(
      500,
      'sms_not_configured',
      'SMS_HTTP_HEADERS doit etre un objet JSON, par exemple {"Authorization":"Bearer xxx"}',
    );
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, renderHttpTemplate(String(value), values, 'text')]),
  );
}

/** Identifiant de message renvoye par la passerelle (journalisation). */
export function extractProviderId(text) {
  try {
    const data = JSON.parse(text);
    return (
      data?.message_id ||
      data?.messageId ||
      data?.sid ||
      data?.id ||
      data?.data?.id ||
      data?.data?.message_id ||
      // WhatsApp (Meta Cloud API) : {"messages":[{"id":"wamid.xxxx"}]}
      data?.messages?.[0]?.id ||
      undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * Message d'erreur lisible renvoye par Meta : `{"error":{"message":"...","code":131047}}`.
 * Le code 131047 signifie « hors fenetre de 24 h » : sans modele valide, Meta
 * refuse d'envoyer un texte libre a un nouvel utilisateur.
 * Fonction pure, testable sans reseau.
 * @param {string} text
 * @returns {string}
 */
export function whatsappErrorMessage(text) {
  try {
    const error = JSON.parse(text)?.error;
    if (!error) return String(text || '').slice(0, 200);
    return [error.message, error.code ? `(code ${error.code})` : '', error.error_data?.details]
      .filter(Boolean)
      .join(' ');
  } catch {
    return String(text || '').slice(0, 200);
  }
}

/**
 * Envoi par passerelle HTTP generique : n'importe quel fournisseur (agregateur
 * tchadien, Termii, Infobip...) se branche par configuration, sans redeployer de
 * code. Voir docs/ENVIRONMENT.md, « Brancher un vrai fournisseur SMS ».
 */
async function sendViaHttp({ to, body }) {
  if (!env.SMS_HTTP_URL) {
    throw new AppError(500, 'sms_not_configured', "SMS_HTTP_URL n'est pas renseignee");
  }
  const values = httpTemplateValues({ to, body });
  const headers = { Accept: 'application/json', ...parseHttpHeaders(env.SMS_HTTP_HEADERS, values) };
  const contentType = String(headers['Content-Type'] || headers['content-type'] || 'application/json');
  const format = contentType.includes('json') ? 'json' : contentType.includes('form') ? 'form' : 'text';
  const template = env.SMS_HTTP_BODY || '{{body}}';
  const isGet = env.SMS_HTTP_METHOD === 'GET';
  const url = isGet
    ? `${env.SMS_HTTP_URL}${env.SMS_HTTP_URL.includes('?') ? '&' : '?'}${renderHttpTemplate(template, values, 'form')}`
    : env.SMS_HTTP_URL;
  const res = await fetch(url, {
    method: env.SMS_HTTP_METHOD,
    headers,
    body: isGet ? undefined : renderHttpTemplate(template, values, format),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new AppError(502, 'sms_provider_error', `HTTP ${res.status} ${text.slice(0, 160)}`.trim());
  }
  logger.info({ provider: 'http', status: res.status }, 'SMS envoye par passerelle HTTP');
  return { ok: true, provider: 'http', providerId: extractProviderId(text) };
}

/**
 * Envoi par WhatsApp (Meta Cloud API) : le canal le moins cher pour un code, car
 * la reponse a un message de l'utilisateur est gratuite pendant 24 h.
 *
 * Deux modes :
 *  - `WHATSAPP_TEMPLATE` renseigne et code disponible : modele valide par Meta,
 *    le CODE partant en premier parametre du corps. C'est le SEUL mode accepte
 *    hors fenetre de 24 h (donc pour un nouvel inscrit) ;
 *  - sinon : texte libre, accepte dans la fenetre de 24 h (ou par un numero de
 *    test autorise dans la console Meta). Meta repond alors 131047.
 *
 * Voir docs/ENVIRONMENT.md, « Envoyer les codes par WhatsApp ».
 * @param {{to: string, body: string, code?: string}} payload
 */
async function sendViaWhatsApp({ to, body, code }) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    throw new AppError(
      500,
      'sms_not_configured',
      "WhatsApp (Meta Cloud API) n'est pas configure : WHATSAPP_TOKEN et WHATSAPP_PHONE_ID sont requis",
    );
  }
  const useTemplate = Boolean(env.WHATSAPP_TEMPLATE) && Boolean(code);
  if (env.WHATSAPP_TEMPLATE && !code) {
    // Alerte ou notification sans code : un modele exige un parametre, on tente
    // donc un texte libre (possible dans la fenetre de 24 h seulement).
    logger.warn({ to }, 'WhatsApp : modele configure mais aucun code a transmettre, envoi en texte libre');
  }
  const message = useTemplate
    ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: whatsappNumber(to),
        type: 'template',
        template: {
          name: env.WHATSAPP_TEMPLATE,
          language: { code: env.WHATSAPP_TEMPLATE_LANG },
          components: [{ type: 'body', parameters: [{ type: 'text', text: String(code) }] }],
        },
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: whatsappNumber(to),
        type: 'text',
        text: { preview_url: false, body },
      };
  const res = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new AppError(502, 'sms_provider_error', `WhatsApp HTTP ${res.status} ${whatsappErrorMessage(text)}`.trim());
  }
  const mode = useTemplate ? 'template' : 'text';
  const providerId = extractProviderId(text);
  logger.info({ provider: 'whatsapp', mode, providerId }, 'Message WhatsApp envoye');
  return { ok: true, provider: 'whatsapp', providerId, mode };
}

/** Canaux disponibles : la cle est la valeur de `SMS_PROVIDER`. */
const PROVIDERS = {
  console: sendViaConsole,
  africastalking: sendViaAfricaTalking,
  twilio: sendViaTwilio,
  http: sendViaHttp,
  whatsapp: sendViaWhatsApp,
};

/**
 * Envoie un message par le canal configure.
 * Si le canal principal echoue, `SMS_FALLBACK_PROVIDER` est essaye une fois
 * (l'echec est journalise dans les deux cas) : un numero sans WhatsApp ou une
 * passerelle en panne ne doit jamais empecher une connexion.
 * @param {{to: string, body: string, code?: string}} payload
 * @returns {Promise<{ok: boolean, provider: string, providerId?: string, simulated?: boolean, fallback?: boolean}>}
 */
export async function sendSms({ to, body, code }) {
  const payload = { to, body, code };
  const primary = PROVIDERS[env.SMS_PROVIDER] || sendViaConsole;
  try {
    return await primary(payload);
  } catch (err) {
    const next = env.SMS_FALLBACK_PROVIDER;
    const fallback = next && next !== 'none' && next !== env.SMS_PROVIDER ? PROVIDERS[next] : null;
    if (!fallback) throw err;
    logger.warn(
      { err: err.message, from: env.SMS_PROVIDER, to: next, phone: to },
      'Canal principal en echec : envoi par le canal de secours',
    );
    const result = await fallback(payload);
    return { ...result, fallback: true, primaryFailed: env.SMS_PROVIDER };
  }
}

export default {
  sendSms,
  renderTemplate,
  SMS_TEMPLATES,
  httpTemplateValues,
  renderHttpTemplate,
  parseHttpHeaders,
  extractProviderId,
  whatsappNumber,
  whatsappErrorMessage,
};
