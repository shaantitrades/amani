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

  SMS_PROVIDER: z.enum(['console', 'africastalking', 'twilio']).default('console'),
  SMS_SENDER_ID: z.string().default('BODOGUI'),
  AFRICASTALKING_USERNAME: z.string().optional().default(''),
  AFRICASTALKING_API_KEY: z.string().optional().default(''),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM: z.string().optional().default(''),

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
