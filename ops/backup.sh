#!/bin/sh
# =============================================================================
# Bodogui - sauvegarde quotidienne PostgreSQL -> Backblaze B2
#
# A executer dans un conteneur qui a acces au reseau Docker interne
# (cron Coolify : "Scheduled Task" sur le service api, ou conteneur dedie).
#
# Variables attendues :
#   DATABASE_URL          postgres://user:pass@db:5432/bodogui
#   BACKUP_DIR            repertoire de travail local (defaut /data/backups)
#   BACKUP_RETENTION_DAYS nombre de jours conserves (defaut 14)
#   B2_BACKUP_BUCKET      bucket Backblaze dedie aux sauvegardes
#   B2_KEY_ID / B2_APP_KEY / B2_REGION / S3_ENDPOINT (optionnel)
#
# Cron suggere (Coolify > Scheduled Task) : 0 2 * * *
# =============================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="bodogui-${STAMP}.sql.gz"
PATH_OUT="${BACKUP_DIR}/${FILE}"

mkdir -p "${BACKUP_DIR}"

echo "[backup] Dump PostgreSQL -> ${PATH_OUT}"
pg_dump --no-owner --no-acl --clean --if-exists "${DATABASE_URL}" | gzip -9 > "${PATH_OUT}"

SIZE="$(wc -c < "${PATH_OUT}" | tr -d ' ')"
echo "[backup] Taille : ${SIZE} octets"

# Controle d'integrite minimal : le fichier doit etre un gzip valide non vide
if [ "${SIZE}" -lt 1024 ]; then
  echo "[backup] ERREUR : dump suspicieusement petit" >&2
  exit 1
fi
gzip -t "${PATH_OUT}"

# --- Envoi vers Backblaze B2 (API S3, compatible aws-cli) --------------------
if [ -n "${B2_BACKUP_BUCKET:-}" ]; then
  ENDPOINT="${S3_ENDPOINT:-https://s3.${B2_REGION:-eu-central-003}.backblazeb2.com}"
  echo "[backup] Envoi vers ${B2_BACKUP_BUCKET} (${ENDPOINT})"
  AWS_ACCESS_KEY_ID="${B2_KEY_ID}" \
  AWS_SECRET_ACCESS_KEY="${B2_APP_KEY}" \
  aws --endpoint-url "${ENDPOINT}" s3 cp "${PATH_OUT}" "s3://${B2_BACKUP_BUCKET}/postgres/${FILE}"
  echo "[backup] Sauvegarde distante envoyee"
else
  echo "[backup] B2_BACKUP_BUCKET non defini : sauvegarde locale uniquement"
fi

# --- Purge locale ------------------------------------------------------------
find "${BACKUP_DIR}" -name 'bodogui-*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete

# --- Verification de restauration (recommandee une fois par mois) -----------
# gunzip -c "${PATH_OUT}" | psql "${RESTORE_DATABASE_URL}" > /dev/null
echo "[backup] Termine"
