import 'dotenv/config';
import { z } from 'zod';
import { parsePhoneList } from '../lib/phone.js';

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def) => z.coerce.number().int().optional().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_NAME: z.string().default('Bodogui'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),

  // DATABASE_URL est prioritaire. A defaut elle est construite a partir des
  // variables PG* (voir buildDatabaseUrl) : le compose peut ainsi transmettre
  // le mot de passe brut, encode correctement pour l'URL.
  DATABASE_URL: z.string().optional().default(''),
  PGUSER: z.string().optional().default(''),
  PGPASSWORD: z.string().optional().default(''),
  PGHOST: z.string().optional().default(''),
  PGPORT: z.string().optional().default(''),
  PGDATABASE: z.string().optional().default(''),
  DB_POOL_MAX: int(10),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET doit faire au moins 16 caracteres'),
  JWT_TTL: z.string().default('30d'),
  REFRESH_TTL_DAYS: int(180),

  OTP_TTL_SECONDS: int(300),
  OTP_MAX_ATTEMPTS: int(5),
  OTP_PER_PHONE_PER_HOUR: int(5),
  OTP_PER_IP_PER_HOUR: int(30),
  OTP_DEV_ECHO: bool(false),
  // Connexion de test (recette sur le site deploye) : code fixe pour des numeros
  // autorises, sans passer par la passerelle SMS. A laisser vide en production
  // publique : voir docs/ENVIRONMENT.md.
  TEST_LOGIN_PHONES: z.string().default(''),
  TEST_LOGIN_CODE: z.string().default(''),

  // Canal d'envoi des codes de connexion et des alertes :
  // console (aucun envoi, code dans les logs) | whatsapp (Meta Cloud API) |
  // http (passerelle generique) | africastalking | twilio.
  SMS_PROVIDER: z.enum(['console', 'africastalking', 'twilio', 'http', 'whatsapp']).default('console'),
  // Canal de secours, essaye quand le canal principal echoue (numero sans
  // WhatsApp, passerelle en panne, modele refuse...). `none` = aucun secours.
  SMS_FALLBACK_PROVIDER: z.enum(['none', 'console', 'africastalking', 'twilio', 'http', 'whatsapp']).default('none'),
  SMS_SENDER_ID: z.string().default('BODOGUI'),
  AFRICASTALKING_USERNAME: z.string().optional().default(''),
  AFRICASTALKING_API_KEY: z.string().optional().default(''),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM: z.string().optional().default(''),
  // Passerelle HTTP generique : brancher N'IMPORTE QUEL fournisseur (agregateur
  // tchadien, Termii, Infobip...) sans redeployer de code. SMS_HTTP_BODY est un
  // modele ou {{to}}, {{to_digits}}, {{body}}, {{from}} et {{app}} sont
  // remplaces, avec l'echappement du format annonce par `Content-Type` (JSON par
  // defaut). Voir docs/ENVIRONMENT.md, « Brancher un vrai fournisseur SMS ».
  SMS_HTTP_URL: z.string().optional().default(''),
  SMS_HTTP_METHOD: z.enum(['POST', 'GET']).default('POST'),
  SMS_HTTP_HEADERS: z.string().optional().default(''),
  SMS_HTTP_BODY: z.string().optional().default(''),
  // WhatsApp (Meta Cloud API) : canal le moins cher pour un code, car un message
  // envoye dans les 24 h qui suivent un message de l'utilisateur est gratuit.
  // WHATSAPP_PHONE_ID = « Phone number ID » (console Meta > WhatsApp > API Setup).
  // WHATSAPP_TEMPLATE = nom d'un modele valide : OBLIGATOIRE pour un nouvel
  // utilisateur (hors fenetre de 24 h), le code partant en 1er parametre du corps.
  // Voir docs/ENVIRONMENT.md, « Envoyer les codes par WhatsApp ».
  WHATSAPP_TOKEN: z.string().optional().default(''),
  WHATSAPP_PHONE_ID: z.string().optional().default(''),
  WHATSAPP_TEMPLATE: z.string().optional().default(''),
  WHATSAPP_TEMPLATE_LANG: z.string().default('fr'),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),

  STORAGE_DRIVER: z.enum(['local', 'minio', 'b2']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./var/storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('bodogui-media'),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  B2_KEY_ID: z.string().optional().default(''),
  B2_APP_KEY: z.string().optional().default(''),
  B2_BUCKET: z.string().optional().default(''),
  B2_REGION: z.string().optional().default(''),
  MAX_PHOTO_BYTES: int(5 * 1024 * 1024),
  MAX_AUDIO_BYTES: int(1024 * 1024),
  // Documents partages dans les groupes (facture, contrat, photo de piece...)
  MAX_FILE_BYTES: int(5 * 1024 * 1024),
  MAX_PHOTOS_PER_AD: int(6),

  IMAGE_MAX_WIDTH: int(1080),
  IMAGE_WEBP_QUALITY: int(62),
  IMAGE_TARGET_BYTES: int(102400),

  STT_PROVIDER: z.enum(['none', 'local', 'google']).default('none'),
  WHISPER_URL: z.string().optional().default(''),
  GOOGLE_STT_API_KEY: z.string().optional().default(''),

  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().default('mailto:support@bodogui.com'),

  FRAUD_AUTO_HIDE_REPORTS: int(3),
  SMS_TEMPLATES_LANGS: z.string().default('fr,ar'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(
    `[bodogui] Configuration invalide (verifiez vos variables d'environnement / fichier .env) :\n${details}`,
  );
  // On LEVE l'erreur (au lieu de sortir ici) pour que src/start.js puisse
  // demarrer un serveur de diagnostic et rendre la cause lisible dans le
  // navigateur : sinon le conteneur mourait et le site renvoyait 502 partout.
  const error = new Error(`Configuration invalide (${parsed.error.issues.length} variable(s) en cause)`);
  error.configIssues = parsed.error.issues;
  throw error;
}

const raw = parsed.data;

/**
 * Construit l'URL PostgreSQL a partir des variables PG* quand DATABASE_URL
 * n'est pas fournie.
 *
 * Le mot de passe est ENCODE (encodeURIComponent) : un mot de passe genere par
 * `openssl rand -base64` contient +, / ou = et une URL assemblee a la main est
 * alors coupee avant l'hote (`getaddrinfo ENOTFOUND <debut du mot de passe>`),
 * ce qui faisait echouer le demarrage de l'API alors que Postgres, lui,
 * acceptait parfaitement ce mot de passe.
 *
 * @param {Record<string, string>} source variables brutes (DATABASE_URL, PG*)
 * @returns {string}
 */
export function buildDatabaseUrl(source = {}) {
  if (source.DATABASE_URL) return source.DATABASE_URL;
  const user = source.PGUSER || 'bodogui';
  const password = source.PGPASSWORD ? `:${encodeURIComponent(source.PGPASSWORD)}` : '';
  const host = source.PGHOST || 'localhost';
  const port = source.PGPORT || '5432';
  const database = source.PGDATABASE || user;
  return `postgres://${encodeURIComponent(user)}${password}@${host}:${port}/${database}`;
}


/** Numeros autorises a la connexion de test (code fixe, sans SMS). */
const testLoginPhones = parsePhoneList(raw.TEST_LOGIN_PHONES);

/**
 * Code fixe de recette : 4 a 8 chiffres. Une valeur invalide ne doit JAMAIS
 * empecher l'API de demarrer (elle est en production et sert tout le site) :
 * on desactive la connexion de test et on le signale dans les logs.
 */
const TEST_LOGIN_CODE_PATTERN = /^\d{4,8}$/;
const testLoginCode = TEST_LOGIN_CODE_PATTERN.test(raw.TEST_LOGIN_CODE) ? raw.TEST_LOGIN_CODE : '';
if (raw.TEST_LOGIN_CODE && !testLoginCode) {
  // eslint-disable-next-line no-console
  console.warn(
    `[bodogui] TEST_LOGIN_CODE invalide (4 a 8 chiffres attendus, recu « ${raw.TEST_LOGIN_CODE} ») : connexion de test DESACTIVEE, l'API demarre normalement.`,
  );
}

/**
 * Signale une passerelle SMS choisie mais incomplete : c'est la cause n°1 des
 * « code incorrect » en recette (le code est bien cree en base, mais aucun SMS
 * ne part). On ne bloque pas le demarrage : la connexion de test et le reste de
 * l'API doivent rester utilisables.
 * @param {Record<string, string>} source variables brutes
 */
function warn(message) {
  // eslint-disable-next-line no-console
  console.warn(`[bodogui] ${message}`);
}

/** Variables indispensables a chaque canal (pour l'avertissement de demarrage). */
const SMS_REQUIRED_VARS = {
  console: [],
  none: [],
  africastalking: ['AFRICASTALKING_USERNAME', 'AFRICASTALKING_API_KEY'],
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
  http: ['SMS_HTTP_URL'],
  whatsapp: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'],
};

function warnIfSmsIncomplete(source) {
  const missing = (SMS_REQUIRED_VARS[source.SMS_PROVIDER] || []).filter((key) => !source[key]);
  if (missing.length) {
    warn(
      `SMS_PROVIDER=${source.SMS_PROVIDER} mais ${missing.join(', ')} vide(s) : AUCUN message ne sera envoye. Voir docs/ENVIRONMENT.md (Brancher un vrai fournisseur SMS).`,
    );
  }
  // WhatsApp n'accepte un texte libre que dans les 24 h qui suivent un message de
  // l'utilisateur : sans modele valide, un nouvel inscrit ne recevrait rien.
  const whatsappActive = source.SMS_PROVIDER === 'whatsapp' || source.SMS_FALLBACK_PROVIDER === 'whatsapp';
  if (whatsappActive && !source.WHATSAPP_TEMPLATE) {
    warn(
      "WhatsApp sans WHATSAPP_TEMPLATE : seul un texte libre est possible, accepte uniquement dans les 24 h suivant un message de l'utilisateur. Definir un modele valide (docs/ENVIRONMENT.md, « Envoyer les codes par WhatsApp »).",
    );
  }
  const fallback = source.SMS_FALLBACK_PROVIDER;
  if (!fallback || fallback === 'none') return;
  if (fallback === source.SMS_PROVIDER) {
    warn(`SMS_FALLBACK_PROVIDER=${fallback} est identique a SMS_PROVIDER : le secours ne sert a rien.`);
    return;
  }
  const fallbackMissing = (SMS_REQUIRED_VARS[fallback] || []).filter((key) => !source[key]);
  if (fallbackMissing.length) {
    warn(`SMS_FALLBACK_PROVIDER=${fallback} mais ${fallbackMissing.join(', ')} vide(s) : le secours ne fonctionnera pas.`);
  }
}

warnIfSmsIncomplete(raw);

export const env = {
  ...raw,
  // Toujours renseignee (DATABASE_URL fournie, sinon construite depuis PG*).
  DATABASE_URL: buildDatabaseUrl(raw),
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Connexion de test : activee uniquement si une liste de numeros ET un code
  // valide sont fournis (les deux sont vides par defaut).
  testLoginPhones,
  testLoginCode,
  testLoginEnabled: Boolean(testLoginCode) && testLoginPhones.length > 0,
  storage: raw.STORAGE_DRIVER === 'b2'
    ? {
        driver: 'b2',
        endpoint: raw.S3_ENDPOINT || (raw.B2_REGION ? `https://s3.${raw.B2_REGION}.backblazeb2.com` : undefined),
        region: raw.B2_REGION || raw.S3_REGION,
        bucket: raw.B2_BUCKET || raw.S3_BUCKET,
        accessKeyId: raw.B2_KEY_ID || raw.S3_ACCESS_KEY_ID,
        secretAccessKey: raw.B2_APP_KEY || raw.S3_SECRET_ACCESS_KEY,
      }
    : {
        driver: raw.STORAGE_DRIVER,
        endpoint: raw.S3_ENDPOINT,
        region: raw.S3_REGION,
        bucket: raw.S3_BUCKET,
        accessKeyId: raw.S3_ACCESS_KEY_ID,
        secretAccessKey: raw.S3_SECRET_ACCESS_KEY,
      },
};

export default env;
