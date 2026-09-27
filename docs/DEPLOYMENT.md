# Deploiement Bodogui sur Coolify (VPS Contabo)

Objectif : mettre en ligne l'API et la PWA avec SSL automatique, backups quotidiens et
monitoring, sans service manage. Toute la pile (PostgreSQL, Redis, API, PWA) tourne dans
Docker sur un seul VPS.

## 1. Preparation du VPS Contabo

- Commande conseillee : **VPS 4 vCPU / 8 Go RAM / 200 Go SSD** (~6-8 EUR/mois), Ubuntu 22.04 ou 24.04.
- Pointez les DNS avant d'installer Coolify (Coolify genere les certificats a la creation des domaines) :

| Enregistrement | Type | Valeur |
| --- | --- | --- |
| `bodogui.com` | A | IP du VPS |
| `www.bodogui.com` | A | IP du VPS |
| `api.bodogui.com` | A | IP du VPS |

- Ouvrez les ports 22, 80, 443 sur le pare-feu.

## 2. Installation de Coolify

```bash
# Sur le VPS (en root)
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Coolify s'installe avec Traefik (proxy inverse + Let's Encrypt). Ouvrez ensuite
`http://<IP>:8000`, creez le compte administrateur, puis dans **Settings** :
- `Server` : verifiez que Docker est detecte ;
- `Notifications` : ajoutez e-mail / Telegram / Discord pour les alertes de deploiement et de sante.

## 3. Creation de la ressource

1. **New Resource > Docker Compose** (basis) :
   - Repository : `https://github.com/shaantitrades/amani`
   - Branch : `main`
   - Compose file : `docker-compose.yml`
2. Coolify cree les 4 services : `db`, `redis`, `api`, `web`.

## 4. Variables d'environnement

Dans l'onglet **Environment Variables**, collez le contenu de `.env.production.example`
et remplacez les valeurs manquantes :

```bash
# sur votre machine
openssl rand -hex 32        # -> JWT_SECRET
openssl rand -hex 24        # -> POSTGRES_PASSWORD (hexadecimal obligatoire, voir ci-dessous)
npx web-push generate-vapid-keys   # -> VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (si push PWA)
```

Points d'attention :

- `POSTGRES_PASSWORD` est obligatoire (le compose refuse de demarrer sans).
- **Ne creez pas de ressource PostgreSQL separee dans Coolify** : le service `db` du compose
  (PostgreSQL 16 + volume `db-data` + reglages memoire pour le VPS) tient ce role. De meme,
  ne definissez pas `DATABASE_URL` ni `REDIS_URL` a la main : le compose les construit a partir
  de `POSTGRES_*` et du service `redis` interne.
- Utilisez un mot de passe PostgreSQL **hexadecimal** (`openssl rand -hex 24`) : il est insere
  tel quel dans l'URL de connexion (`+`, `/`, `=` ou `@` la casseraient).
- `CORS_ORIGINS` doit contenir exactement les domaines du frontend (URL du site, ex.
  `http://<domaine>.sslip.io`). Laisse vide, l'API accepte toutes les origines mais le signale
  dans ses logs au demarrage : c'est un raccourci de recette, a definir avant la mise en
  production reelle.
- `SMS_PROVIDER=africastalking` + identifiants : sans SMS, aucun utilisateur ne peut s'inscrire.
- `STORAGE_DRIVER=b2` + cles Backblaze B2 (voir section 6).

## 5. Domaines et SSL

Dans les reglages de chaque service :

| Service | Port | Domaine |
| --- | --- | --- |
| `web` | 80 | `https://bodogui.com` |
| `api` | 4000 | `https://api.bodogui.com` |

Activez **HTTPS automatique** (Let's Encrypt). Coolify gere le renouvellement.

> **Aucun port n'est publie sur l'hote par `docker-compose.yml`** : le service `web` declare
> seulement `expose: 80`, car Traefik (installe avec Coolify) occupe deja 80/443 sur le VPS et
> route vers le conteneur. Ajouter `ports: '80:80'` ferait echouer le demarrage avec
> `port is already allocated`. Pour lancer la meme pile **sans** Coolify, utilisez la surcouche :
>
> ```bash
> docker compose -f docker-compose.yml -f docker-compose.ports.yml up -d
> ```

Le service `web` (Nginx) relaie deja `/api` et `/media` vers `api` sur le reseau Docker
interne : le frontend peut donc fonctionner sans sous-domaine API, mais garder
`api.bodogui.com` reste utile pour les tests et un futur client Android.

## 6. Stockage des medias

### Production : Backblaze B2 (+ Cloudflare)

1. Backblaze > **App Keys** > creer une cle limitee au bucket `bodogui-media` (lecture/ecriture).
2. Renseigner `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET`, `B2_REGION` dans Coolify.
3. Cloudflare > ajouter le domaine `cdn.bodogui.com` en CNAME vers B2, puis activer le cache
   sur `cdn.bodogui.com/file/*`. Dans Coolify, `PUBLIC_MEDIA_URL` peut alors pointer vers le CDN.
4. Les medias sont de toute facon servis par `/media/<cle>` (proxy backend + cache Nginx 30 j),
   ce qui rend un changement de fournisseur transparent.

### Developpement : MinIO

`docker compose -f docker-compose.dev.yml up -d` demarre MinIO (console sur
`http://localhost:9001`, identifiants `bodogui` / `bodogui-secret`) et cree le bucket
`bodogui-media` automatiquement. Utilisez `STORAGE_DRIVER=minio` et
`S3_ENDPOINT=http://localhost:9000`.

## 7. Migrations et donnees de demonstration

Les migrations tournent automatiquement au demarrage du conteneur `api`
(`node src/db/migrate.js && node src/server.js`).

Pour charger le jeu de donnees de test en preproduction, ouvrez un terminal dans le
conteneur `api` (Coolify > Terminal) :

```bash
node src/db/seed.js            # idempotent
node src/db/seed.js --reset    # supprime puis reinsere les donnees de demo
```

En **production reelle**, n'inserez que le referentiel indispensable (categories et quartiers
de N'Djamena) — sans comptes, annonces, photos ni vocaux de demonstration :

```bash
node src/db/seed.js --reference-only
```

> Sans ce referentiel, `GET /api/v1/categories` renvoie `{"items":[]}` et l'ecran d'accueil de
> l'application est vide : les migrations ne creent que le schema, jamais les donnees de
> reference.

### Tester la connexion avant l'ouverture du compte SMS

Tant que le compte Africa's Talking n'est pas actif, aucune connexion n'est possible sur le site
deploye : le code part par SMS. Deux solutions de recette (voir
[ENVIRONMENT.md](ENVIRONMENT.md#se-connecter-sans-passerelle-sms-recette)) :

```bash
# Dans Coolify > Environment (puis redeployer)
TEST_LOGIN_PHONES=+23566000001      # votre numero de test, format international
TEST_LOGIN_CODE=12345               # code fixe, 4 a 8 chiffres
```

- Connectez-vous depuis l'application avec ce numero, puis saisissez `12345` (il faut avoir
  touche « recevoir le code » auparavant : le code reste a usage unique et valable 5 minutes).
- Chaque connexion reussie cree le compte (inscription implicite) : un numero jamais vu
  devient un nouvel utilisateur, avec le role `user`. Pour tester la moderation, promouvez-le :

```bash
node -e "import('./src/lib/db.js').then(async ({query,closePool})=>{await query(\"UPDATE users SET role='admin' WHERE phone='+23566000001'\");process.exit(0)})"
```

- **Avant l'ouverture au public**, supprimez `TEST_LOGIN_PHONES` et `TEST_LOGIN_CODE` puis
  redeployez : un code fixe est un mot de passe partage.

Le jeu de donnees de demonstration (`node src/db/seed.js`) cree aussi des comptes de test
(+235 66 00 00 00 a +235 66 00 00 06) : ils ne fonctionnent que si vous avez lance le seed complet.

## 8. Backups

Voir [BACKUPS.md](BACKUPS.md) : `pg_dump` quotidien vers Backblaze B2 via une
**Scheduled Task** Coolify (02:00) et verification de restauration mensuelle.

## 9. Monitoring et sante

- `GET https://api.bodogui.com/healthz` : 200 seulement si PostgreSQL repond, avec le detail
  des dependances (`database`, `redis`, `storage`, `push`, `stt`, `imagePipeline`).
- `GET https://bodogui.com/healthz` : sonde de Nginx.
- Les deux healthchecks sont declares dans `docker-compose.yml` (Docker redemarre un
  conteneur qui echoue 3 fois).
- Ajoutez une alerte Coolify sur l'etat du conteneur `api` (Telegram/Discord).

## 10. Mise a jour

1. Poussez sur `main` : Coolify peut redeployer automatiquement (Webhook GitHub).
2. Le redeploiement rejoue les migrations (idempotentes) puis redemarre l'API.
3. Verifiez apres deploiement :

```bash
cd backend
node scripts/smoke.mjs https://api.bodogui.com
```

Le smoke test accepte les deux configurations : sur un domaine **API** dedie il lit la sonde JSON
de l'API, sur un **domaine unique** (site + API derriere Nginx) il lit la sonde `ok` du site puis
verifie l'API via `/api/v1/*`. Si le jeu de categories est vide, il rappelle la commande a lancer
(`node src/db/seed.js --reference-only`).

Le smoke test verifie `/healthz`, la version, le referentiel (categories) et une validation
d'entree.

## 11. Verification post-deploiement (checklist)

- [ ] `https://api.bodogui.com/healthz` retourne `status: ok` et `database: true`
- [ ] Le certificat SSL est valide sur les deux domaines
- [ ] Le site est servi en **HTTPS** : sans HTTPS, Chrome/Android ne propose pas l'installation
- [ ] L'installation de la PWA est **obligatoire** a la premiere visite, puis l'application s'ouvre
      sans navigateur (« Ajouter a l'ecran d'accueil » sur iPhone)
- [ ] Une connexion reussit (numero de test ou vrai SMS) ; `TEST_LOGIN_PHONES` / `TEST_LOGIN_CODE`
      sont vides avant l'ouverture au public
- [ ] Un vrai numero recoit bien le SMS de code (pays du pilote)
- [ ] Une annonce publiee depuis un telephone apparait avec sa photo et son vocal
- [ ] Le message vocal du vendeur se lit dans l'application
- [ ] `node scripts/smoke.mjs https://api.bodogui.com` passe sans echec
- [ ] La sauvegarde de la nuit est presente dans le bucket B2 `bodogui-backups`

## 12. Depannage

| Symptome | Cause | Correction |
| --- | --- | --- |
| `GET /` renvoie `{"error":{"code":"not_found","message":"Route inconnue : GET /"}}` | Le domaine est branche sur le service **`api`** (port 4000) au lieu de **`web`** (port 80) : c'est la reponse normale de l'API pour une route inconnue | Coolify > service `web` > **Domains** : ajouter l'URL avec le port **80**, puis retirer cette URL des domaines de `api` et redeployer |
| `https://<domaine>/healthz` renvoie du **JSON** (`{"status":"ok",...}`) | Idem : c'est la sonde de l'API | Le site doit repondre `ok` en texte brut (sonde Nginx du conteneur `web`) |
| Page blanche, requetes `/api/v1/...` en 404 depuis le site | Domaine bien sur `web`, mais conteneur `api` arrete ou migrations en echec | Logs du service `api` (variables `POSTGRES_*`, `DATABASE_URL` construite par le compose) |
| `/healthz` repond `ok` mais **tous** les appels `/api/v1/...` renvoient **502 Bad Gateway** (page Nginx) | Le conteneur `api` n'ecoute pas : demarrage en echec (`[bodogui] Configuration invalide` — `JWT_SECRET` trop court, `DATABASE_URL`…), migrations en erreur, ou `db`/`redis` jamais `healthy` (le compose exige `condition: service_healthy`) | Coolify > service `api` > **Logs** (chercher `Configuration invalide` ou une erreur Postgres) ; verifier l'etat de `db` et `redis` ; depuis le terminal du service `web` : `wget -qO- http://api:4000/healthz` (reponse JSON attendue = reseau OK, l'API est en cause ; echec DNS ou connexion refusee = conteneur arrete) |
| Le site affiche une erreur de connexion alors que `curl` fonctionne (logs du service `api` : `Origine non autorisee : http://...`) | `CORS_ORIGINS` vide ou ne contenant pas l'origine exacte du site (protocole + domaine, sans slash final) | Mettre l'URL exacte du site dans `CORS_ORIGINS` puis redeployer `api` (une liste vide accepte tout, mais un domaine errone bloque le navigateur) |
| Logs du service `api` : `password authentication failed` puis conteneur arrete (donc 502 partout) | `POSTGRES_PASSWORD` ne correspond pas a celui qui a cree le volume `db-data` (mot de passe modifie apres le premier deploiement), ou il contient `+`, `/`, `=` ou `@` (genere avec `openssl rand -base64`) et casse `DATABASE_URL` construite par le compose | Remettre l'ancien mot de passe, ou supprimer le volume `db-data` (donnees de recette) puis redeployer ; toujours generer un mot de passe **hexadecimal** (`openssl rand -hex 24`) |
| Logs du service `api` : `[bodogui] Configuration invalide ... JWT_SECRET` | Le compose verifie seulement la **presence** de `JWT_SECRET`, pas sa longueur (16 caracteres minimum exiges par l'API) | `JWT_SECRET` = `openssl rand -hex 32` puis redeployer |
| `web` refuse de demarrer : `port is already allocated` | Un `ports: '80:80'` a ete (re)ajoute dans `docker-compose.yml` | Garder `expose: '80'` : Traefik, installe par Coolify, publie deja 80/443 sur l'hote |
| Les SMS renvoient vers un mauvais lien | `PUBLIC_WEB_URL` / `PUBLIC_API_URL` pas mises a jour | Mettre l'URL publique reelle (domaine Coolify ou domaine definitif) avant de tester les SMS |
| « Code incorrect » alors qu'aucun SMS n'arrive | Passerelle SMS non configuree (`SMS_PROVIDER=africastalking` sans identifiants) : le code est bien cree, mais jamais envoye | `SMS_PROVIDER=console` (le code apparait dans les logs du service `api`) ou connexion de test `TEST_LOGIN_PHONES` + `TEST_LOGIN_CODE` (voir § 7) |
| L'application reste bloquee sur « Installer Bodogui » | Le site n'est pas en HTTPS (l'installation PWA exige une origine securisee) ou le navigateur ne sait pas installer | Activer `https://` dans **Domains** ; sur un navigateur sans installation, le lien « Ouvrir dans le navigateur » apparait apres quelques secondes |
| Photos et vocaux disparus apres un redeploiement | `STORAGE_DRIVER=local` sans volume persistant | Passer a `STORAGE_DRIVER=b2` (production) ou garder le volume `api-storage` |
| Le certificat HTTPS ne s'obtient pas | DNS pas encore propage, ou domaine en `sslip.io` sans `https://` | Verifier la resolution DNS, puis activer `https://` dans **Domains** ; en attendant, tester en `http://` |

Rappel : le site (PWA) et l'API peuvent tourner sur **un seul domaine**, celui du service `web` :
le Nginx du conteneur relaie `/api`, `/media` et `/voice` vers `api:4000` sur le reseau Docker
interne. Un sous-domaine `api.*` n'est utile que pour un futur client Android ou des tests
directs.
