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

/**
 * Envoie un SMS via la passerelle configuree.
 * @returns {Promise<{ok: boolean, provider: string, providerId?: string, simulated?: boolean}>}
 */
export async function sendSms({ to, body }) {
  const payload = { to, body };
  switch (env.SMS_PROVIDER) {
    case 'africastalking':
      return sendViaAfricaTalking(payload);
    case 'twilio':
      return sendViaTwilio(payload);
    default:
      return sendViaConsole(payload);
  }
}

export default { sendSms, renderTemplate, SMS_TEMPLATES };
