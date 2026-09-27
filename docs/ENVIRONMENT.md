# Variables d'environnement

Toutes les variables sont lues par `backend/src/config/env.js` (validation zod au demarrage :
l'API refuse de demarrer si une valeur obligatoire manque ou est invalide).
Une configuration invalide ne rend plus le conteneur `api` muet : la cause est publiee en JSON
sur `/api/v1/healthz` (voir « Diagnostic de demarrage »).
Le frontend, lui, ne lit que des variables `VITE_*` (voir la section Frontend en fin de page).

## Obligatoires en production

| Variable | Exemple | Role |
| --- | --- | --- |
| `JWT_SECRET` | `openssl rand -hex 32` | Signature des jetons **et** hachage des codes OTP (16 caracteres minimum) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | Mot de passe PostgreSQL (service `db` du compose) |
| `CORS_ORIGINS` | `https://bodogui.com,https://app.bodogui.com` | Origines autorisees (vide = toutes, avec un avertissement au demarrage) |
| `PUBLIC_WEB_URL` | `https://bodogui.com` | Liens dans les SMS |
| `PUBLIC_API_URL` | `https://api.bodogui.com` | Liens profonds |

La connexion PostgreSQL n'est plus assemblee a la main dans le compose : celui-ci transmet
`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` sous forme de variables `PGHOST`, `PGPORT`,
`PGUSER`, `PGPASSWORD`, `PGDATABASE`, et l'API construit l'URL en **encodant** le mot de passe
(`encodeURIComponent`). Un mot de passe en base64 (`openssl rand -base64`, qui contient `+`, `/`,
`=` ou `@`) fonctionne donc : l'important est qu'il soit **identique** a celui qui a cree le volume
`db-data`. Ne definissez `DATABASE_URL` que pour viser un autre serveur : elle est alors utilisee
telle quelle. `REDIS_URL` pointe deja vers le service `redis` interne.

## Diagnostic de demarrage (API)

Le conteneur `api` ne meurt plus en silence : un demarrage impossible reste lisible depuis le site.

| Situation | Comportement | Ou lire la cause |
| --- | --- | --- |
| Configuration invalide (variable manquante, `JWT_SECRET` trop court, `DATABASE_URL` illisible) | `src/start.js` lance un **serveur de diagnostic** : toute requete repond `503` avec la cause en JSON | `<domaine>/api/v1/healthz` et logs du service `api` (banniere `DEMARRAGE IMPOSSIBLE`) |
| Postgres injoignable ou mot de passe refuse | L'API demarre en **mode degrade** : elle repond, mais `checks.database` vaut `false` | `<domaine>/api/v1/healthz` (`startup.migrations`, `startup.error`, `startup.hint`) |

| Variable | Defaut | Description |
| --- | --- | --- |
| `STRICT_STARTUP` | `0` | `1` : ancien comportement, le conteneur sort en erreur si la base est injoignable (l'orchestrateur voit l'echec, mais Nginx renvoie 502 sans explication) |
| `MIGRATE_ATTEMPTS` | `12` | Tentatives de migration au demarrage (Postgres peut mettre quelques secondes a accepter les connexions apres un redemarrage) |
| `MIGRATE_RETRY_MS` | `5000` | Delai entre deux tentatives |

Le serveur de diagnostic repond volontairement `503` (et non `200`) : la sonde Coolify signale
l'anomalie tout en laissant le conteneur vivant, ce qui permet de lire la cause dans un navigateur.


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
| `TEST_LOGIN_PHONES` | — | Numeros autorises au **code fixe de recette** (E.164, separes par des virgules) |
| `TEST_LOGIN_CODE` | — | Code fixe (4 a 8 chiffres) pour ces numeros, **sans SMS**. A vider apres la recette |
| `JWT_TTL` | `30d` | Duree du jeton d'acces |
| `REFRESH_TTL_DAYS` | `180` | Duree du jeton de rafraichissement |

## SMS

| Variable | Description |
| --- | --- |
| `SMS_PROVIDER` | `console` (dev), `africastalking`, `twilio`, `http` |
| `SMS_SENDER_ID` | Expediteur affiche (ex : `BODOGUI`) |
| `AFRICASTALKING_USERNAME` / `AFRICASTALKING_API_KEY` | Identifiants Africa's Talking |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | Identifiants Twilio |
| `SMS_HTTP_URL` | Passerelle generique : URL appelee pour chaque SMS |
| `SMS_HTTP_METHOD` | `POST` (defaut) ou `GET` |
| `SMS_HTTP_HEADERS` | Objet JSON d'en-tetes (ex : `{"Authorization":"App xxx"}`) |
| `SMS_HTTP_BODY` | Modele du corps / de la requete (voir plus bas) |

En mode `console`, les SMS sont ecrits dans les logs (aucun cout). Au demarrage,
l'API **avertit dans les logs** quand une passerelle est choisie mais incomplete
(`SMS_PROVIDER=africastalking` sans cles, `SMS_PROVIDER=http` sans URL...) : c'est
la cause n°1 des « code incorrect » alors que le code a bien ete cree en base.

### Brancher un vrai fournisseur SMS

Aucun code a ecrire dans les deux cas : tout se regle par variables
d'environnement (redemarrage du service `api`, pas de redeploiement).

1. **Africa's Talking** (integre, couvre le Tchad selon l'editeur — a confirmer
   aupres de leur support avant l'ouverture publique) :

   ```bash
   SMS_PROVIDER=africastalking
   SMS_SENDER_ID=BODOGUI                # expéditeur enregistré (alphanumérique)
   AFRICASTALKING_USERNAME=bodogui      # utilisateur de la console
   AFRICASTALKING_API_KEY=atsk_xxxxxxxx
   ```

2. **N'importe quel autre fournisseur** (agrégateur local tchadien, Termii,
   Infobip, passerelle d'un opérateur...) avec `SMS_PROVIDER=http`. Le corps est
   un modèle où sont remplacés :

   | Jeton | Valeur |
   | --- | --- |
   | `{{to}}` | Numéro E.164 (`+23566000000`) |
   | `{{to_digits}}` | Chiffres seuls (`23566000000`, certains fournisseurs refusent le `+`) |
   | `{{body}}` | Texte du SMS (court, 160 caractères) |
   | `{{from}}` | `SMS_SENDER_ID` |
   | `{{app}}` | `APP_NAME` |

   Exemple JSON (Termii et la plupart des agrégateurs) :

   ```bash
   SMS_PROVIDER=http
   SMS_HTTP_URL=https://api.ng.termii.com/api/sms/send
   SMS_HTTP_METHOD=POST
   SMS_HTTP_HEADERS={"Content-Type":"application/json"}
   SMS_HTTP_BODY={"to":"{{to_digits}}","from":"{{from}}","sms":"{{body}}","type":"plain","channel":"generic","api_key":"CLE_API"}
   ```

   Exemple formulaire (`application/x-www-form-urlencoded`) :

   ```bash
   SMS_PROVIDER=http
   SMS_HTTP_URL=https://passerelle.example.td/send
   SMS_HTTP_HEADERS={"Content-Type":"application/x-www-form-urlencoded","Authorization":"Bearer CLE"}
   SMS_HTTP_BODY=to={{to_digits}}&message={{body}}
   ```

   Le format est deduit de `Content-Type` : `application/json` (defaut) échappe
   les valeurs (guillemets, accents, sauts de ligne) pour que le corps reste un
   JSON valide ; `application/x-www-form-urlencoded` encode les valeurs en URL ;
   sinon la valeur est insérée telle quelle (utile dans les en-têtes). Avec
   `SMS_HTTP_METHOD=GET`, le modèle est placé dans l'URL (chaîne de requête).

   Le fournisseur doit répondre en `2xx`, sinon l'envoi est journalisé en erreur
   (`HTTP <statut>`) **sans bloquer la réponse** : l'utilisateur peut redemander
   un code. L'identifiant de message renvoyé (`message_id`, `messageId`, `sid`,
   `id`) est conservé dans les logs.

### Cout des SMS

- **Gratuit** : `SMS_PROVIDER=console` (le code s'affiche dans les logs du service
  `api`) et la connexion de test `TEST_LOGIN_PHONES` + `TEST_LOGIN_CODE`. Aucun
  SMS, aucun coût : idéal pour la recette, la formation et les démonstrations.
- **Premiers vrais SMS** : la plupart des agrégateurs offrent un crédit d'essai ou
  un environnement de test à l'inscription (Africa's Talking, Termii, Infobip,
  Twilio). Comptez ensuite de l'ordre de 15 à 50 FCFA par SMS vers le Tchad selon
  le fournisseur et le volume — à confirmer avec leur grille tarifaire, qui
  change par pays. Un seul SMS suffit par connexion (le modèle OTP tient en un
  SMS) et les numéros de recette ne consomment aucun crédit.
- **Comparer sans s'engager** : `SMS_PROVIDER=http` permet d'essayer plusieurs
  passerelles en changeant seulement `SMS_HTTP_*`.

### Se connecter sans passerelle SMS (recette)

Deux solutions, utilisables ensemble :

1. **`SMS_PROVIDER=console`** : aucun SMS n'est envoye, mais le texte complet — code
   inclus — apparait dans les logs du conteneur `api` (Coolify > Logs).
2. **Connexion de test** : renseignez

   ```bash
   TEST_LOGIN_PHONES=+23566000001,+23566123456   # numeros acceptes (E.164)
   TEST_LOGIN_CODE=12345                         # 4 a 8 chiffres
   ```

   Ces numeros se connectent alors avec le code fixe, sans SMS. Le code reste a
   usage unique (il faut redemander le code a chaque connexion), expire en
   `OTP_TTL_SECONDS` et respecte les limites anti-abus.

> `TEST_LOGIN_PHONES` / `TEST_LOGIN_CODE` **doivent etre vides** en production
> publique : un code fixe est un mot de passe partage. Le serveur ecrit un
> avertissement au demarrage lorsque la connexion de test est active.
> Un `TEST_LOGIN_CODE` mal saisi (moins de 4 chiffres, lettres, espaces) ne bloque
> pas l'API : la connexion de test est simplement desactivee, avec un
> avertissement au demarrage.


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

Le frontend ne lit que des variables `VITE_*` exposees au moment du build (fichier `frontend/.env`) :

| Variable | Defaut | Description |
| --- | --- | --- |
| `VITE_API_URL` | `/api/v1` | Chemin de l'API (proxy Nginx en production) |
| `VITE_API_PROXY` | `http://127.0.0.1:4000` | Cible du proxy Vite en developpement |
| `VITE_INSTALL_GATE` | *(active)* | `off` desactive le portail d'installation obligatoire (reserve au developpement) |

## Securite

- PostgreSQL et Redis **ne sont jamais exposes** : ils vivent uniquement sur le reseau Docker
  interne (`networks.internal`), sans `ports:` publies dans `docker-compose.yml`.
- Les codes OTP sont stockes haches (HMAC-SHA256 + secret), comparés en temps constant.
- Limitation de debit : 240 req/min globale, 5 demandes de code par numero et par heure,
  30 par IP, 30 ecritures/min, 20 SMS/min.
- `JWT_SECRET` compromis = reinitialisation complete : les jetons sont signes cote serveur et
  les sessions peuvent etre revoquees en base (`refresh_tokens`).
