#!/bin/sh
# =============================================================================
# Bodogui - taches planifiees (a configurer comme "Scheduled Tasks" dans Coolify)
#
# 1) Purge des codes OTP expires               -> chaque jour a 03:00
#    curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" https://api.bodogui.com/api/v1/admin/maintenance/purge-otp
#
# 2) Envoi des notifications en retard         -> toutes les 15 minutes
#    (le worker interne le fait deja ; utile en secours)
#    curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" https://api.bodogui.com/api/v1/admin/maintenance/dispatch-notifications
#
# 3) Rappels de securite SMS (anti-arnaque) de temps en temps
#    -> SELECT d'utilisateurs actifs et insertion dans notifications (channel sms)
#
# 4) Sauvegarde PostgreSQL -> Backblaze B2      -> chaque nuit a 02:00
#    sh /app/ops/backup.sh  (service api, avec pg_dump installe)
#
# 5) Verification de la restauration            -> 1er du mois
#    sh /app/ops/restore.sh /data/backups/<derniere sauvegarde>
#
# Exemple de SQL pour les rappels de securite :
# -----------------------------------------------------------------------------
# INSERT INTO notifications (user_id, channel, kind, body, voice_key, language)
# SELECT u.id, 'sms', 'safety_reminder',
#        'Bodogui: ne payez jamais avant d''avoir vu le produit. Rencontrez-vous dans un lieu public.',
#        'safety_warning', u.language
# FROM users u
# WHERE u.notify_sms = true AND u.banned_at IS NULL
#   AND u.last_seen_at > now() - interval '30 days'
#   AND NOT EXISTS (
#     SELECT 1 FROM notifications n
#     WHERE n.user_id = u.id AND n.kind = 'safety_reminder'
#       AND n.created_at > now() - interval '30 days'
#   );
# =============================================================================
