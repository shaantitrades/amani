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
openssl rand -base64 24     # -> POSTGRES_PASSWORD
npx web-push generate-vapid-keys   # -> VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (si push PWA)
```

Points d'attention :

- `POSTGRES_PASSWORD` est obligatoire (le compose refuse de demarrer sans).
- `CORS_ORIGINS` doit contenir exactement les domaines du frontend.
- `SMS_PROVIDER=africastalking` + identifiants : sans SMS, aucun utilisateur ne peut s'inscrire.
- `STORAGE_DRIVER=b2` + cles Backblaze B2 (voir section 6).

## 5. Domaines et SSL

Dans les reglages de chaque service :

| Service | Port | Domaine |
| --- | --- | --- |
| `web` | 80 | `https://bodogui.com` |
| `api` | 4000 | `https://api.bodogui.com` |

Activez **HTTPS automatique** (Let's Encrypt). Coolify gere le renouvellement.

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

Le smoke test verifie `/healthz`, la version, le referentiel (categories) et une validation
d'entree.

## 11. Verification post-deploiement (checklist)

- [ ] `https://api.bodogui.com/healthz` retourne `status: ok` et `database: true`
- [ ] Le certificat SSL est valide sur les deux domaines
- [ ] L'installation de la PWA est proposee (Chrome Android > "Ajouter a l'ecran d'accueil")
- [ ] Un vrai numero recoit bien le SMS de code (pays du pilote)
- [ ] Une annonce publiee depuis un telephone apparait avec sa photo et son vocal
- [ ] Le message vocal du vendeur se lit dans l'application
- [ ] `node scripts/smoke.mjs https://api.bodogui.com` passe sans echec
- [ ] La sauvegarde de la nuit est presente dans le bucket B2 `bodogui-backups`
