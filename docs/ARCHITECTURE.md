# Architecture Bodogui (Phase 1)

## Vue d'ensemble

```
                      Telephone Android d'entree de gamme (PWA installee)
                             |  HTTPS (2G/3G, donnees limitees)
                             v
  +------------------------------ VPS Contabo + Coolify ------------------------------+
  |   [ Traefik + Let's Encrypt ]                                                    |
  |            +--> web (Nginx : PWA statique, /api et /media en proxy)              |
  |            |            +--> /api/v1/*  --------------------> api (Node/Express) |
  |            |            +--> /media/* (proxy cache 30 j) ---> api                 |
  |            |                                                |       |           |
  |            |                                          db (PostgreSQL) redis       |
  |            +--> SMS via Africa's Talking / Twilio                                |
  |            +--> Medias : Backblaze B2 (prod) ou MinIO (dev), Cloudflare en CDN    |
  +----------------------------------------------------------------------------------+
```

## Backend (`backend/`)

| Dossier | Contenu |
| --- | --- |
| `src/config/env.js` | Chargement et validation stricte des variables (zod) |
| `src/lib/` | `db` (pool + transactions), `cache` (Redis + repli memoire), `phone` (E.164 Tchad), `crypto` (OTP), `visibility` (filtres blocage), `errors`, `pagination`, `serialize` |
| `src/services/` | `otp`, `tokens`, `blocks`, `ads`, `groups`, `notifications`, `sms`, `push`, `storage`, `media`, `stt`, `voice` |
| `src/middleware/` | `auth` (JWT + bannissement), `validate` (zod), `rateLimit`, `upload` (multer), `error` |
| `src/routes/` | `auth`, `users`, `ads`, `media`, `media-proxy`, `groups`, `blocks`, `reports`, `messages`, `search`, `admin`, `meta`, `health` |
| `src/db/` | `migrations/*.sql`, `migrate.js`, `seed.js`, `seed-assets.js` |
| `tests/` | Tests unitaires + `api.integration.test.js` (parcours complet sur PostgreSQL) |

### Regles de visibilite (coeur du produit)

1. **Blocage symetrique** : `getBlockedIds(userId)` renvoie les utilisateurs bloques **et**
   ceux qui m'ont bloque ; cette liste est injectee dans chaque requete de fil
   (`a.owner_id <> ALL($n::uuid[])`). Le cache Redis (60 s) est invalide a chaque
   blocage/deblocage.
2. **Bannissement plateforme** : `requireAuth` verifie `users.banned_at` / `ban_expires_at`
   et refuse la connexion (403 + `voiceKey: account_banned`). Les jetons sont revoques.
3. **Bannissement de groupe** : `group_bans` neutralise le contenu du groupe pour le membre
   exclu.
4. **Groupes prives** : une annonce publiee dans un groupe prive n'apparait dans les fils
   publics que pour ses membres actifs (condition SQL ajoutee dans `listAdFeed`). Les
   annonces hors groupe et celles des groupes publics restent visibles de tous.
5. **Conversation interne** : parler a un vendeur ne quitte jamais l'application (aucun lien
   WhatsApp). `POST /messages` exige un jeton : un lien d'annonce partage conduit a
   l'inscription, puis `afterLoginPath` (`frontend/src/lib/chat.js`) ramene le visiteur sur
   l'annonce, ou il ouvre la conversation (`/messages/<vendeur>`). Le fil prive ne remonte
   que pour les deux personnes concernees, et un blocage le ferme dans les deux sens.
5. **Annonces** : seules les annonces `published` sortent du fil ; le proprietaire et les
   administrateurs voient les autres statuts.
6. **Quartier facultatif** : le quartier est un repere, jamais une condition. Le profil le fixe
   une fois (`PATCH /me`, effacable via `clear_district`), l'assistant de publication ne le
   demande plus, et l'accueil ajoute `include_unknown=true` pour continuer a montrer les annonces
   sans quartier ; seuls les filtres explicites de la recherche (`/ads?district_id=`) sont stricts.
7. **Publication sans choix superflu** : l'assistant ne demande ni le lieu ni le type
   « je vends / je cherche » (deux boutons presque identiques pour des vendeurs qui ne lisent
   pas). Toute annonce creee depuis l'application est une vente (`kind: 'sell'`), mais `kind`
   reste servi et filtrable par l'API : les annonces `want` deja publiees restent lisibles.
8. **Correction d'annonce** : le proprietaire modifie son annonce via `PATCH /ads/:id`
   (`updateAd`) — mise a jour partielle (champ absent = inchange, valeur vide = effacee) et photos
   remplacees (les medias retires sont marques orphelins). `published_at` n'est jamais retouche :
   sans cette regle, un vendeur pourrait faire remonter sans fin son annonce en tete du fil en la
   corrigeant. La suppression reste une transition de statut (`deleted`), deja utilisee par
   « Mes annonces ».

### Notifications

Insertion en base (`notifications`, statut `queued`) puis worker dans le meme conteneur qui
relit la file toutes les 30 s et envoie SMS/push. Aucun message perdu au redemarrage,
3 tentatives, journal exploitable par le support.

Anti-spam SMS : `notifyUser({ smsDedupeMinutes })` empeche l'envoi de deux SMS du meme type
a la meme personne dans la fenetre (10 minutes pour les messages vocaux).

## Base de donnees (PostgreSQL 16)

| Table | Role |
| --- | --- |
| `users` | Comptes (telephone unique, langue, quartier, notifications, ban) |
| `otp_codes` | Codes SMS haches (HMAC) avec expiration et compteur de tentatives |
| `refresh_tokens` | Sessions longues revocables |
| `districts` | Quartiers (profil, filtres du fil ; plus demandes a la publication) |
| `categories` | Grille d'icones, libelles fr/ar/ff |
| `ads` | Annonces (prix, devise, vocal, transcription, geoloc, `client_uuid` idempotent) |
| `ad_photos` | Photos WebP + vignettes (6 max) |
| `groups`, `group_members`, `group_bans` | Groupes, roles, exclusions |
| `blocks` | Blocages entre utilisateurs |
| `bans` | Historique des bannissements plateforme |
| `reports` | Signalements (scam, illegal, nudity, spam, autre) |
| `ratings` | Evaluations vocales apres transaction |
| `messages` | Conversations acheteur/vendeur **dans l'application** (texte ou vocal) |
| `group_messages` | Discussion de groupe (texte, vocal, photo, document) |
| `notifications` | File d'envoi SMS/push/vocal |
| `push_subscriptions` | Abonnements Web Push (VAPID) |
| `media_assets` | Inventaire des medias (quota, nettoyage des orphelins) |
| `voice_searches` | Recherches vocales (analytique, suggestions) |
| `audit_log` | Journal des actions de moderation |
| `schema_migrations` | Suivi des migrations |

Index principaux : fil (`status, published_at DESC`), categorie, quartier, groupe, prix,
recherche trigramme (`ads_search_idx` sur titre + description), index partiels sur les
bannissements actifs.

## Frontend (`frontend/`)

| Dossier | Contenu |
| --- | --- |
| `src/i18n/` | 3 langues (fr, ar, ff) + catalogue des messages vocaux |
| `src/lib/` | `api` (fetch + JWT + refresh), `idb` (IndexedDB), `outbox` (file hors ligne), `audio` (MediaRecorder Opus), `voice` (retour vocal), `image` (compression WebP), `geo`, `push`, `format`, `chat` (conversation interne, accroche d'annonce avec son lien, liens cliquables, retour apres inscription), `account` (zone sensible repliee : suppression de compte jamais a un seul appui) |
| `src/components/` | `ui` (gros boutons, feuilles modales), `forms` (photos, clavier, categories, quartiers), `media` (vocal), `AdCard`, `ContactBar`, `ReportSheet`, `MapView` |
| `src/pages/` | Welcome, Login, Home, Browse, AdDetail, Sell, Groups, GroupDetail, Messages, Account, MyAds, Blocked, Admin |
| `src/context/AppContext.jsx` | Langue, session, referentiels, etat reseau, brouillons |
| `scripts/generate-icons.mjs` | Generateur de PNG (encodeur minimal zlib + CRC32, sans dependance) |
| `nginx.conf` | SPA, cache long des assets, proxy API et medias |

### Strategie hors ligne

- **App shell** : precache Workbox (26 fichiers, 447 Ko).
- **Referentiels** (`/bootstrap`, `/categories`, `/districts`) : `NetworkFirst` + copie
  IndexedDB (`cacheSet('bootstrap', ...)`) pour l'affichage meme sans reseau.
- **Medias** : `CacheFirst` (30 jours) : les photos deja vues restent consultables.
- **Tuiles OpenStreetMap** : `CacheFirst` (14 jours) pour la carte de quartier.
- **Publication** : si hors ligne, l'annonce complete (photos + vocal en Blob) est stockee
  dans IndexedDB puis envoyee automatiquement au retour du reseau, avec `client_uuid` pour
  eviter tout doublon cote serveur.

### Retour vocal (accessibilite des non-lecteurs)

`src/lib/voice.js` applique une chaine de repli :

1. fichier Opus enregistre par un natif (`/voice/<langue>/<cle>.opus`, cache 90 jours) ;
2. synthese vocale du navigateur (uniquement si `SPEECH_SYNTHESIS_ENABLED = true`) ;
3. bip, uniquement si explicitement demande (`announce(key, { fallbackBeep: true })`).

**Etat actuel : retour vocal desactive par defaut.** Les messages vocaux natifs n'etant pas
encore enregistres, la synthese vocale etait la seule source de parole : elle est donc
coupee (`SPEECH_SYNTHESIS_ENABLED = false`) et l'application ne joue rien automatiquement.
L'utilisateur peut activer la voix avec le bouton 🔊 (en-tete de l'accueil et « Mon compte »),
preference conservee dans `localStorage` (`bodogui.voice.enabled`, `bodogui.voice.tts`).

Ce qui reste toujours audible : les **messages vocaux des utilisateurs** (description du
vendeur, messages recus) — c'est la fonctionnalite cle, elle ne depend pas de la synthese.

Pour reactiver la voix du systeme : enregistrer les fichiers Opus (aucun changement de code)
et/ou passer `SPEECH_SYNTHESIS_ENABLED` a `true` ; le bouton 🔊 du clavier numerique
reapparait alors automatiquement (`isSpeechEnabled()`).

## Economie de donnees

| Element | Cible | Moyen |
| --- | --- | --- |
| Photo | < 100 Ko | Compression client (canvas -> WebP) puis serveur (sharp, qualite adaptative) |
| Vignette de liste | ~30 Ko | 360 px WebP, utilises dans les grilles |
| Message vocal | < 50 Ko / 30 s | MediaRecorder Opus 24 kbps, mono |
| Page initiale | < 250 Ko | Code split par ecran, Leaflet charge a la demande |
| Requetes | — | Cache HTTP 20 s sur les fils, 1 an sur les medias |

## Choix techniques et justifications

| Choix | Justification |
| --- | --- |
| PWA plutot qu'application native | Aucun magasin d'applications, mise a jour instantanee, installation depuis le navigateur |
| Express plutot que Fastify | Ecosysteme mur, middleware de rate limiting et multer bien documentes |
| PostgreSQL + Redis auto-heberges | Cout nul en MVP, templates Coolify en un clic |
| Numero de telephone comme identifiant | Les utilisateurs cibles n'ont ni e-mail ni mot de passe |
| Opus 24 kbps | Meilleur compromis qualite/poids de la voix sur reseau 2G |
| Blocage des le MVP | La confiance conditionne l'adoption sur un marche de l'occasion informel |
| `client_uuid` | Indispensable pour publier hors ligne sans creer de doublons |
| Photos generees par le seed | Jeu de donnees de test autoportant (aucun binaire a versionner) |
