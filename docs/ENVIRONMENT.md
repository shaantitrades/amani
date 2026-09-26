# Variables d'environnement

Toutes les variables sont lues par `backend/src/config/env.js` (validation zod au demarrage :
l'API refuse de demarrer si une valeur obligatoire manque ou est invalide).
Le frontend n'utilise qu'une seule variable optionnelle : `VITE_API_URL`.

## Obligatoires en production

| Variable | Exemple | Role |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://bodogui:...@db:5432/bodogui` | Connexion PostgreSQL |
| `JWT_SECRET` | `openssl rand -hex 32` | Signature des jetons **et** hachage des codes OTP |
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` | Utilise par l'image PostgreSQL du compose |
| `CORS_ORIGINS` | `https://bodogui.com,https://app.bodogui.com` | Origines autorisees |
| `PUBLIC_WEB_URL` | `https://bodogui.com` | Liens dans les SMS |
| `PUBLIC_API_URL` | `https://api.bodogui.com` | Liens profonds |

## Generales

| Variable | Defaut | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` active les logs JSON et coupe l'echo OTP |
| `PORT` | `4000` | Port d'ecoute de l'API |
| `LOG_LEVEL` | `info` | `silent`, `warn`, `info`, `debug` |
| `DB_POOL_MAX` | `10` | Connexions PostgreSQL simultanees |
| `REDIS_URL` | `redis://localhost:6379` | Cache OTP, blocages, rate limiting |
| `DISABLE_REDIS` | — | `1` force le cache memoire (tests) |
| `DISABLE_WORKERS` | — | `1` desactive le worker de notifications (tests) |

## Authentification OTP

| Variable | Defaut | Description |
| --- | --- | --- |
| `OTP_TTL_SECONDS` | `300` | Duree de validite du code (5 minutes) |
| `OTP_MAX_ATTEMPTS` | `5` | Tentatives par code avant blocage |
| `OTP_PER_PHONE_PER_HOUR` | `5` | Limite par numero (anti-abus) |
| `OTP_PER_IP_PER_HOUR` | `30` | Limite par adresse IP |
| `OTP_DEV_ECHO` | `false` | **Jamais en production** : renvoie le code dans la reponse |
| `JWT_TTL` | `30d` | Duree du jeton d'acces |
| `REFRESH_TTL_DAYS` | `180` | Duree du jeton de rafraichissement |

## SMS

| Variable | Description |
| --- | --- |
| `SMS_PROVIDER` | `console` (dev), `africastalking`, `twilio` |
| `SMS_SENDER_ID` | Expediteur affiche (ex : `BODOGUI`) |
| `AFRICASTALKING_USERNAME` / `AFRICASTALKING_API_KEY` | Identifiants Africa's Talking |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | Identifiants Twilio |

En mode `console`, les SMS sont ecrits dans les logs (aucun cout).

## Stockage des medias

| Variable | Defaut | Description |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` (dev), `minio`, `b2` |
| `STORAGE_LOCAL_DIR` | `./var/storage` | Repertoire en mode local |
| `S3_ENDPOINT` | — | `http://localhost:9000` (MinIO) ou endpoint S3 de B2 |
| `S3_BUCKET` | `bodogui-media` | Bucket |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | Identifiants S3/MinIO |
| `B2_KEY_ID` / `B2_APP_KEY` | — | Cle Backblaze B2 |
| `B2_BUCKET` / `B2_REGION` | `bodogui-media` / `eu-central-003` | Bucket et region B2 |
| `MAX_PHOTO_BYTES` | `5242880` | Taille maximale d'une photo envoyee (5 Mo) |
| `MAX_AUDIO_BYTES` | `1048576` | Taille maximale d'un message vocal (1 Mo) |
| `MAX_PHOTOS_PER_AD` | `6` | Nombre de photos par annonce |
| `IMAGE_MAX_WIDTH` | `1080` | Largeur maximale apres compression |
| `IMAGE_WEBP_QUALITY` | `62` | Qualite de depart (baissee si besoin) |
| `IMAGE_TARGET_BYTES` | `102400` | Cible de poids des photos (100 Ko) |

## Speech-to-Text (optionnel, Phase 2)

| Variable | Description |
| --- | --- |
| `STT_PROVIDER` | `none` (MVP), `local` (Whisper auto-heberge), `google` |
| `WHISPER_URL` | Endpoint du serveur Whisper (`/asr`) |
| `GOOGLE_STT_API_KEY` | Cle API Google Speech-to-Text |

Quand le STT est desactive, la recherche vocale oriente l'utilisateur vers les categories
les plus actives au lieu d'afficher des resultats textuels.

## Notifications push PWA

| Variable | Description |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Cle publique (exposee par `/api/v1/bootstrap`) |
| `VAPID_PRIVATE_KEY` | Cle privee |
| `VAPID_SUBJECT` | `mailto:support@bodogui.com` |

Generez les cles : `npx web-push generate-vapid-keys`. Si elles sont absentes, le canal push
est ignore et les SMS restent la seule voie de notification.

## Moderation et backups

| Variable | Defaut | Description |
| --- | --- | --- |
| `FRAUD_AUTO_HIDE_REPORTS` | `3` | Nombre de signalements avant masquage automatique |
| `BACKUP_DIR` | `/data/backups` | Repertoire des dumps |
| `B2_BACKUP_BUCKET` | `bodogui-backups` | Bucket dedie aux sauvegardes |
| `BACKUP_RETENTION_DAYS` | `14` | Purge locale des dumps |

## Frontend

| Variable | Defaut | Description |
| --- | --- | --- |
| `VITE_API_URL` | `/api/v1` | Chemin de l'API (proxy Nginx en production) |
| `VITE_API_PROXY` | `http://127.0.0.1:4000` | Cible du proxy Vite en developpement |

## Securite

- PostgreSQL et Redis **ne sont jamais exposes** : ils vivent uniquement sur le reseau Docker
  interne (`networks.internal`), sans `ports:` publies dans `docker-compose.yml`.
- Les codes OTP sont stockes haches (HMAC-SHA256 + secret), comparés en temps constant.
- Limitation de debit : 240 req/min globale, 5 demandes de code par numero et par heure,
  30 par IP, 30 ecritures/min, 20 SMS/min.
- `JWT_SECRET` compromis = reinitialisation complete : les jetons sont signes cote serveur et
  les sessions peuvent etre revoquees en base (`refresh_tokens`).
