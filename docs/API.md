# API Bodogui (v1)

Base : `https://api.bodogui.com/api/v1` (developpement : `http://localhost:4000/api/v1`).
Toutes les reponses sont en JSON. Les erreurs suivent toujours ce format :

```json
{ "error": { "code": "code_machine", "message": "Message lisible", "voiceKey": "cle_message_vocal" } }
```

`voiceKey` correspond a un message du catalogue vocal (`/voice/<langue>/<cle>.opus`) : le
client joue automatiquement le bon son, ce qui permet a un utilisateur non lecteur de
comprendre l'erreur.

Authentification : `Authorization: Bearer <accessToken>`. Le jeton dure 30 jours et se
renouvelle via `POST /auth/refresh` (rotation : l'ancien jeton est revoque).

## Sante et referentiels

| Methode | Chemin | Auth | Description |
| --- | --- | --- | --- |
| GET | `/healthz` (racine) | — | 200 si PostgreSQL repond ; detail des dependances |
| GET | `/version` | — | Version de l'API |
| GET | `/bootstrap` | — | Categories, quartiers, langues, devises, fonctionnalites (`vapidPublicKey`, `maxPhotos`, `stt`) |
| GET | `/categories` | — | Grille d'icones |
| GET | `/districts?city=` | — | Quartiers / villes |
| GET | `/voice/manifest` | — | Catalogue des messages vocaux par langue |

## Authentification

| Methode | Chemin | Corps | Reponse |
| --- | --- | --- | --- |
| POST | `/auth/request-code` | `{ phone, language? }` | `{ phone, sent, ttlSeconds, devCode? }` |
| POST | `/auth/verify` | `{ phone, code, language?, name?, district_id?, city? }` | `{ user, tokens, isNewUser, voiceKey }` |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ user, tokens }` |
| POST | `/auth/logout` | — | `{ ok: true }` |

`phone` accepte les formats locaux (`66 12 34 56`, `066123456`) et internationaux
(`+23566123456`, `0023566123456`). Codes de 5 chiffres, valables 5 minutes, 5 tentatives,
5 demandes par numero et par heure.

## Profil et compte

| Methode | Chemin | Description |
| --- | --- | --- |
| GET | `/me` | Profil + statistiques (`publishedAds`, `unreadMessages`) |
| PATCH | `/me` | Nom, `name_audio_key`, avatar, langue, quartier (`district_id`, `clear_district`), ville, `notify_sms`, `notify_push` |
| DELETE | `/me` | Suppression definitive du compte |
| GET | `/me/ads?status=published,sold` | Mes annonces (brouillons compris) |
| GET | `/me/stats` | Vues, ventes, note moyenne |
| GET | `/me/blocked` | Utilisateurs bloques |
| GET | `/me/notifications` | Historique SMS / push |
| GET | `/me/reports` | Signalements envoyes |
| POST | `/me/push-subscription` | `{ endpoint, keys: { p256dh, auth } }` |
| DELETE | `/me/push-subscription` | `{ endpoint }` |
| GET | `/users/:id` | Profil public (403 si blocage dans un sens ou l'autre) |
| POST | `/users/:id/ratings` | `{ stars, ad_id?, audio_key?, comment? }` |

## Annonces

| Methode | Chemin | Description |
| --- | --- | --- |
| GET | `/ads` | Fil public : `category_id`, `district_id`, `include_unknown`, `kind`, `group_id`, `min_price`, `max_price`, `q`, `limit`, `offset` |
| GET | `/ads/:id` | Detail + `permissions` (`can_call`, `can_message`, `can_report`, `is_owner`) |
| GET | `/ads/:id/contact` | Numero, `tel_link` (aucun masquage) — la discussion se tient dans Bodogui |
| GET | `/ads/:id/safety` | Regles anti-arnaque |
| POST | `/ads` | Publication (voir ci-dessous) |
| PATCH | `/ads/:id` | Correction par le proprietaire (voir ci-dessous) |
| PATCH | `/ads/:id/status` | `published`, `sold`, `archived`, `deleted`, `pending` |
| POST | `/ads/:id/interest` | "Je suis interesse" : notifie le vendeur (SMS + push) |
| GET | `/search?q=` | Recherche (memes filtres) + suggestions de categories si aucun resultat |
| POST | `/search/voice` | Multipart `audio` : transcription (si STT) puis recherche |
| POST | `/search/alert` | `{ q?, category_id?, district_id? }` : alerte SMS |

### Publier une annonce

```http
POST /api/v1/ads
Authorization: Bearer <token>
Content-Type: application/json

{
  "category_id": "uuid",
  "kind": "sell",
  "district_id": "uuid",
  "city": "N'Djamena",
  "lat": 12.115, "lng": 15.055,
  "title": "Vache laitiere",
  "description_text": "...",
  "description_audio_key": "audio/ads/users/.../xxx.ogg",
  "description_audio_seconds": 24,
  "price_amount": 285000,
  "currency": "XAF",
  "price_negotiable": true,
  "client_uuid": "uuid-fourni-par-le-client",
  "photos": [{ "storage_key": "photos/...", "thumb_key": "thumbs/...", "size_bytes": 84000 }]
}
```

- `client_uuid` rend l'appel **idempotent** : republier la meme annonce hors ligne renvoie
  `{ duplicate: true }` avec l'annonce existante.
- `kind` (`sell` par defaut, ou `want`) reste accepte et filtrable (`GET /ads?kind=`), mais
  l'assistant de publication n'affiche **plus** le choix « je vends / je cherche » : deux
  boutons presque identiques egarent les vendeurs qui ne lisent pas. L'application envoie
  donc toujours `sell`.
- La description (vocale, texte ou titre) est **facultative** : photos et categorie suffisent.
- `district_id`, `city`, `lat` et `lng` sont **facultatifs** (`category_id` est le seul champ
  exige). L'assistant de publication ne demande plus le lieu : le quartier du profil (ou du
  groupe) est repris quand il existe, sinon l'annonce est publiee sans quartier.
- **Quartier du profil** : choisi une fois dans l'ecran "Mon compte" (`PATCH /me` avec
  `district_id`), effacable avec `clear_district: true` (`district_id: null` est ignore par le
  `COALESCE`). Il ne bloque jamais la publication et peut rester vide.
- **Filtrage** : `GET /ads?district_id=<uuid>` est strict (filtre explicite de la recherche).
  L'accueil ajoute `include_unknown=true` pour garder les annonces sans quartier : sans cela, un
  profil avec quartier ne verrait presque rien, car la majorite des vendeurs (bergers, zones
  rurales ou desertiques) publient hors du referentiel des quartiers.

### Modifier ou supprimer une annonce

```http
PATCH /api/v1/ads/<id>
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Vache laitiere",
  "description_text": "Prix baisse, animal en bonne sante",
  "price_amount": 199000,
  "category_id": "uuid",
  "description_audio_key": "audio/ads/users/.../nouveau.ogg",
  "description_audio_seconds": 12,
  "photos": [{ "storage_key": "photos/...", "thumb_key": "thumbs/..." }]
}
```

- **Proprietaire (ou administrateur de la plateforme) uniquement** : sinon `403 not_ad_owner`.
- Mise a jour **partielle** : un champ absent reste inchange, une valeur `null` (ou une chaine
  vide) l'efface — c'est ainsi qu'on retire un prix ou un titre. Un corps vide (aucun champ, aucune
  photo) renvoie `400 nothing_to_update`.
- `category_id` est obligatoire en base : ne jamais envoyer `null`. `kind` et `group_id` ne sont
  pas modifiables (une annonce ne change pas de fil apres publication).
- `photos` **remplace** la liste existante : les medias retires sont marques orphelins
  (`media_assets.is_orphan = true`) et les nouveaux rattaches a l'annonce.
- **Statut et date de publication inchanges** : corriger une annonce ne la republie pas et ne la
  remonte pas dans le fil. Reponse : `{ "ad": {...}, "voiceKey": "ad_updated" }`.
- Cote application : `frontend/src/lib/adEdit.js` (brouillon pre-rempli et corps de requete),
  assistant ouvert par `/sell?edit=<id>`, boutons ✏️ MODIFIER et 🗑️ SUPPRIMER sur la fiche.
- **Suppression** : `PATCH /ads/:id/status` avec `{ "status": "deleted" }`, toujours confirmee dans
  l'interface (fiche annonce et « Mes annonces »).

## Medias

| Methode | Chemin | Description |
| --- | --- | --- |
| POST | `/media/photo` | Multipart `photo` -> WebP < 100 Ko + vignette 360 px |
| POST | `/media/audio` | Multipart `audio` (Opus) + `seconds` + `scope` (`ads`, `message`, `rating`) |
| POST | `/media/avatar` | Photo de profil |
| POST | `/media/cover` | Couverture de groupe |
| GET | `/media/mine` | Nombre de fichiers et poids total |
| GET | `/media/<cle>` (racine) | Lecture du media (cache 1 an, compatible Cloudflare) |
| DELETE | `/media/<cle>` (racine) | Suppression d'un media non rattache |

Formats audio acceptes : Ogg/Opus (Firefox), WebM/Opus (Chrome/Android), MP4 (Safari).

## Groupes

| Methode | Chemin | Description |
| --- | --- | --- |
| POST | `/groups` | Nom, `name_audio_key`, description vocale, couverture, `is_private` |
| GET | `/groups?mine=1&q=&city=` | Liste (les prives n'apparaissent qu'aux membres) |
| GET | `/groups/:id` | Detail + appartenance |
| POST | `/groups/:id/join` / `leave` | Adhesion / depart |
| GET | `/groups/:id/ads` | Fil du groupe |
| GET | `/groups/:id/messages?limit=&offset=` | **Discussion du groupe** (membres uniquement ; messages bloques filtres) |
| POST | `/groups/:id/messages` | **Envoyer un message** : JSON `{ body }` (texte) ou multipart `audio` (vocal Opus) / `photo` (photo) / `file` (document) |
| GET | `/groups/:id/members` | Membres (reserve aux membres) |
| POST | `/groups/:id/members/:userId/ban` | Exclure un membre (admin) |
| DELETE | `/groups/:id/members/:userId/ban` | Reintegrer un membre (admin) |
| DELETE | `/groups/:id/ads/:adId` | Supprimer une publication (admin ou auteur) |

## Messages entre utilisateurs (conversation interne)

La discussion avec un vendeur se tient **dans l'application** : aucun renvoi
vers WhatsApp ou un autre service. Le compte est obligatoire pour ecrire
(`401` sans jeton) : un lien d'annonce partage conduit donc d'abord a
l'inscription, puis ramene sur l'annonce.

| Methode | Chemin | Description |
| --- | --- | --- |
| POST | `/messages` | `{ recipient_id, ad_id?, kind, audio_key?, audio_seconds?, transcript?, body? }` |
| GET | `/messages/threads` | Conversations + compteur de non lus |
| GET | `/messages/:userId` | Fil avec une personne (marque comme lu) |
| POST | `/messages/:id/report` | Signaler un message |

`kind` vaut `voice` (message vocal, `audio_key` obligatoire) ou `text`
(`body` obligatoire). Un utilisateur bloque ne peut ni lire ni ecrire, dans un
sens comme dans l'autre.

Depuis une fiche d'annonce (bouton DISCUTER), le premier message est
pre-rempli avec le titre et le **lien** de l'annonce
(`chatStateFromAd` + `adIntroText` de `frontend/src/lib/chat.js`) : le vendeur
voit exactement de quelle annonce il s'agit, meme sans historique de
conversation.

Le SMS d'alerte est limite a un envoi par destinataire toutes les 10 minutes
(`smsDedupeMinutes`) ; les notifications push restent systematiques.

## Blocage, signalement, moderation

| Methode | Chemin | Description |
| --- | --- | --- |
| POST | `/blocks` | `{ user_id, reason? }` -> disparition des contenus dans les deux sens |
| DELETE | `/blocks/:userId` | Debloquer |
| GET | `/blocks/status/:userId` | `{ i_blocked, blocked_me }` |
| POST | `/reports` | `{ target_type, target_id, reason_code, comment?, block_user? }` |
| GET | `/reports/reasons` | Motifs avec icones |
| GET | `/admin/overview` | Signalements ouverts, annonces suspectes, comptes suspendus |
| PATCH | `/admin/reports/:id` | `{ status: reviewed \| actioned \| dismissed }` |
| POST | `/admin/ads/:id/moderate` | `{ action: hide \| restore \| delete }` |
| POST | `/admin/users/:id/ban` | `{ reason, days? }` (sans `days` = definitif) |
| POST | `/admin/users/:id/unban` | Lever la suspension |
| POST | `/admin/users/:id/promote` | Nommer un moderateur |
| POST | `/admin/maintenance/purge-otp` | Purger les codes expires |
| POST | `/admin/maintenance/dispatch-notifications` | Relancer la file d'envoi |

Le seuil `FRAUD_AUTO_HIDE_REPORTS` (defaut 3) masque automatiquement une annonce trop
signalee (statut `pending`, visible par la moderation).

## Limites de debit

| Portee | Limite |
| --- | --- |
| Global | 240 requetes / minute / IP |
| Demande de code | 5 / heure / numero et `OTP_PER_IP_PER_HOUR` par IP |
| Ecritures (annonces, messages, groupes) | 30 / minute |
| Medias | 60 / minute |
| Notifications declenchees (interet) | 20 / heure |

## Exemples

```bash
# Inscription
curl -s -X POST https://api.bodogui.com/api/v1/auth/request-code \
  -H 'Content-Type: application/json' -d '{"phone":"66123456"}'
curl -s -X POST https://api.bodogui.com/api/v1/auth/verify \
  -H 'Content-Type: application/json' -d '{"phone":"66123456","code":"12345"}'

# Fil du quartier, sans compte
curl -s "https://api.bodogui.com/api/v1/ads?district_id=<uuid>&limit=10"

# Publication avec photo et message vocal
curl -s -X POST https://api.bodogui.com/api/v1/media/photo \
  -H "Authorization: Bearer $TOKEN" -F photo=@vache.jpg
curl -s -X POST https://api.bodogui.com/api/v1/media/audio \
  -H "Authorization: Bearer $TOKEN" -F audio=@voix.webm -F seconds=18
curl -s -X POST https://api.bodogui.com/api/v1/ads \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"category_id":"<uuid>","description_audio_key":"audio/ads/.../x.webm","price_amount":250000,
       "photos":[{"storage_key":"photos/.../x.webp"}],"client_uuid":"<uuid>"}'

# Bloquer un utilisateur (effet immediat dans les deux sens)
curl -s -X POST https://api.bodogui.com/api/v1/blocks \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"user_id":"<uuid>","reason":"Tentative d arnaque"}'
```
