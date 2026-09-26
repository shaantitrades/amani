# Sauvegardes et restauration

Objectif : ne jamais perdre les comptes, les annonces et les messages. Deux niveaux de
sauvegarde : quotidien automatique (Backblaze B2) et verification mensuelle de restauration.

## Ce qui est sauvegarde

| Donnee | Sauvegarde | Methode |
| --- | --- | --- |
| Base PostgreSQL (comptes, annonces, groupes, blocages...) | Oui, quotidienne | `pg_dump` -> gzip -> Backblaze B2 (`ops/backup.sh`) |
| Medias (photos, messages vocaux) | Oui (objet) | Backblaze B2 : versioning + cycle de vie des versions |
| Redis | Non | Contenu reconstructible (cache OTP, blocages, rate limiting) |
| Variables d'environnement | Oui, manuelle | Copie chiffree de `.env.production` hors du VPS |

Redis n'est volontairement pas sauvegarde : sa perte n'entraine qu'une reconnexion des
utilisateurs et un cache froid (les donnees reelles sont en PostgreSQL).

## Mise en place

### 1. Bucket dedie aux sauvegardes

Dans Backblaze, creez un bucket **prive** `bodogui-backups` (different du bucket medias) et
une cle d'application limitee a ce bucket.

### 2. Tache planifiee Coolify

Coolify > votre ressource > **Scheduled Tasks** :

| Champ | Valeur |
| --- | --- |
| Nom | `backup-postgres` |
| Commande | `sh /app/ops/backup.sh` |
| Frequence | `0 2 * * *` (chaque nuit a 02:00) |
| Conteneur | `api` |

Le conteneur `api` doit pouvoir executer `pg_dump` et `aws`. L'image actuelle contient
`ca-certificates` et `tini` mais pas `postgresql-client` ni `aws-cli` : ajoutez-les si vous
utilisez la tache planifiee dans ce conteneur, ou lancez la sauvegarde depuis un conteneur
dedie base sur `postgres:16-alpine` (qui contient `pg_dump`) avec `aws-cli` installe.

Variables a definir pour la tache :

```
DATABASE_URL=postgres://bodogui:<motdepasse>@db:5432/bodogui
BACKUP_DIR=/data/backups
BACKUP_RETENTION_DAYS=14
B2_BACKUP_BUCKET=bodogui-backups
B2_KEY_ID=...
B2_APP_KEY=...
B2_REGION=eu-central-003
```

### 3. Verification automatique de la sauvegarde

Le script `ops/backup.sh` :

1. execute `pg_dump` (`--clean --if-exists`) et compresse en gzip ;
2. verifie que le fichier depasse 1 Ko puis teste l'integrite (`gzip -t`) ;
3. envoie le dump dans `s3://bodogui-backups/postgres/` ;
4. purge les dumps locaux de plus de `BACKUP_RETENTION_DAYS` jours.

En cas d'echec, la tache sort en erreur (code 1) : configurez une alerte Coolify
(Telegram/Discord/e-mail) sur l'echec des taches planifiees.

### 4. Restauration

```bash
# Depuis le conteneur (ou une machine avec psql)
DATABASE_URL=postgres://bodogui:<mdp>@db:5432/bodogui \
  sh ops/restore.sh /data/backups/bodogui-20260101-020000.sql.gz
```

Le script verifie l'archive, restaure dans une transaction unique et rappelle les requetes de
controle. **Procedure conseillee** :

1. restaurer d'abord sur une base de test (`bodogui_restore`) ;
2. verifier les comptages (`users`, `ads`, `blocks`) ;
3. seulement ensuite basculer la production.

Requetes de controle :

```sql
SELECT count(*) FROM users;
SELECT count(*) FROM ads WHERE status = 'published';
SELECT count(*) FROM blocks;
SELECT max(created_at) FROM ads;      -- fraicheur des donnees
```

### 5. Test mensuel obligatoire

Premier de chaque mois, restaurez la derniere sauvegarde sur une base jetable et verifiez que
l'API demarre dessus. Une sauvegarde jamais restauree n'est pas une sauvegarde.

## Retention recommandee

| Emplacement | Duree | Justification |
| --- | --- | --- |
| Local (`/data/backups`) | 14 jours | Restauration rapide sans reseau |
| Backblaze B2 | 30 a 90 jours | Protection contre les erreurs de longue duree |
| Versions B2 des medias | 30 jours | Recuperation d'une photo supprimee par erreur |

## Catalogue de restauration (RTO / RPO)

| Indicateur | Valeur visee |
| --- | --- |
| RPO (perte de donnees maximale) | 24 heures (dump quotidien) |
| RTO (temps de remise en service) | < 1 heure (base de quelques centaines de Mo) |

Pour reduire le RPO en Phase 2 : archivage WAL en continu (`pg_basebackup` + `archive_command`
vers B2) ou replication sur un second VPS.
