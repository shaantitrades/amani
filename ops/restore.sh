#!/bin/sh
# =============================================================================
# Bodogui - restauration d'une sauvegarde PostgreSQL
#
# Usage :
#   DATABASE_URL=postgres://bodogui:...@db:5432/bodogui \
#   ./restore.sh /data/backups/bodogui-20260101-020000.sql.gz
#
# Attention : la base cible est ecrasee (le dump contient DROP ... IF EXISTS).
# Procedure recommandee : restaurer d'abord sur une base de test, verifier,
# puis basculer la production.
# =============================================================================
set -eu

FILE="${1:-}"
if [ -z "${FILE}" ] || [ ! -f "${FILE}" ]; then
  echo "Usage : $0 <fichier.sql.gz>" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL est obligatoire" >&2
  exit 1
fi

echo "[restore] Verification de l'archive"
gzip -t "${FILE}"

echo "[restore] Restauration de ${FILE} vers ${DATABASE_URL}"
gunzip -c "${FILE}" | psql --single-transaction "${DATABASE_URL}"

echo "[restore] Termine. Verifiez :"
echo "  SELECT count(*) FROM users;"
echo "  SELECT count(*) FROM ads WHERE status = 'published';"
