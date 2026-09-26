# Bodogui

Plateforme de petites annonces **vocales et visuelles** pour le Tchad et le Sahel.
Les utilisateurs vendent et achetent des animaux, motos, voitures, telephones, vetements,
terrains... avec des **photos**, la **voix** et un **appel direct**. Aucune ecriture n'est
obligatoire : chaque action est realisable avec des icones, des couleurs et des messages
vocaux.

> Phase 1 (MVP) : PWA React + API Node.js + PostgreSQL/Redis auto-heberges sur VPS Contabo
> via Coolify. Pas de paiement en ligne, **pas de masquage de numero**, blocage utilisateur
> des le MVP.

## Contenu du depot

```
bodogui/
  backend/              API Node.js (Express) + migrations + seed + tests
  frontend/             PWA React (Vite) + service worker + icones + tests
  wireframes/index.html Maquettes des ecrans (palette WhatsApp)
  docs/                 Installation, deploiement Coolify, API, backups, voix
  ops/                  Scripts backup.sh / restore.sh + taches planifiees
  docker-compose.yml    Pile de production Coolify (db, redis, api, web)
  docker-compose.dev.yml Pile de developpement (db, redis, MinIO)
  .env.example          Toutes les variables (dev et prod)
  .env.production.example Variables de production a coller dans Coolify
```

## Demarrage rapide (local)

Prerequis : Node.js 20+, PostgreSQL 14+ (ou Docker).

```bash
# 1. Base de donnees + Redis + MinIO (optionnel)
docker compose -f docker-compose.dev.yml up -d

# 2. API
cd backend
cp ../.env.example .env        # puis renseigner JWT_SECRET et DATABASE_URL
npm install
npm run migrate                # cree les tables
npm run seed                   # categories, quartiers, annonces de demo
                               # (production : npm run seed -- --reference-only)
npm run dev                    # http://localhost:4000

# 3. PWA
cd ../frontend
npm install
npm run dev                    # http://localhost:5173 (proxy /api et /media)
```

Le numero de test s'affiche dans la reponse HTTP (`devCode`) et dans les logs du serveur
(`OTP_DEV_ECHO=true` en developpement).

Comptes de demonstration crees par le seed (Tchad) :

| Numero | Role |
| --- | --- |
| +235 66 00 00 00 | Administrateur (moderation) |
| +235 66 00 00 01 | Vendeuse (Achta A., Moursal) |
| +235 66 00 00 02 | Vendeur (Moussa B., Chagoua) |
| +235 66 00 00 06 | Compte suspendu (pour tester le message vocal de suspension) |

## Tests

```bash
# Backend : 41 tests unitaires + parcours complet API (base requise)
cd backend
npm test
$env:RUN_DB_TESTS=1; npm test        # PowerShell (Linux/macOS : RUN_DB_TESTS=1 npm test)

# Frontend : utilitaires (formatage, i18n, edition d'annonce), generateur d'icones
cd frontend
npm test
npm run build                        # genere aussi les icones PWA
```

Le test de bout en bout couvre : inscription par SMS, publication avec photo et message
vocal, fil d'annonces, recherche filtree, contact direct, **blocage/deblocage**, signalement,
**modification et suppression d'annonce**, moderation et bannissement.

## Fonctionnalites du MVP

- **Inscription par telephone** + code SMS (aucun email, aucun mot de passe, aucune piece
  d'identite). Badge "Verifie" apres confirmation.
- **Publication en 5 gestes** : photos (6 max, WebP < 100 Ko), description vocale **facultative**
  (Opus, 60 s max ; titre et texte optionnels reveles a la demande), prix (clavier geant),
  categorie (grille d'icones), recapitulatif puis publication.
  Le choix « je vends / je cherche » a ete **retire** : deux boutons presque identiques egaraient
  les vendeurs qui ne lisent pas. Toute annonce publiee depuis l'application est une vente
  (`kind: 'sell'`) ; l'API accepte et filtre toujours `want` pour les annonces existantes.
  Le lieu n'est **pas** demande : le quartier du profil (choisi une fois dans « Mon compte »,
  facultatif et effacable) ou du groupe est repris quand il existe, sinon l'annonce est publiee
  sans quartier — les bergers et les vendeurs des zones rurales ou
  desertiques du Tchad, absents du referentiel des quartiers, ne sont plus bloques. Chaque etape
  possede une validation explicite (`frontend/src/lib/wizard.js`) : aucun blocage possible.
  Depuis un groupe, `/sell?group=<id>` rattache l'annonce au groupe (et non au fil public).
- **Gestion de son annonce (✏️ / 🗑️)** : depuis la fiche d'une annonce publiee, le vendeur la
  **corrige** (memes etapes que la publication, pre-remplies : photos, prix, voix, categorie) ou la
  **supprime** apres confirmation. Aucun doublon : la correction passe par `PATCH /ads/:id`
  (`frontend/src/lib/adEdit.js` construit la requete) et ne change ni le statut ni la date de
  publication, donc l'annonce ne remonte pas artificiellement dans le fil. Les deux actions sont
  aussi accessibles depuis « Mes annonces » (✏️ / 🗑️, suppression confirmee).
- **Consultation** : grille de photos, prix en gros, ecoute du vocal du vendeur, filtres par
  categorie / quartier / prix, recherche vocale (Speech-to-Text optionnel).
- **Contact — la discussion reste dans l'application** : depuis la fiche d'une annonce,
  l'acheteur appelle (📞), **discute dans Bodogui** (💬 : conversation a bulles, texte ou
  vocal, facon WhatsApp mais sans quitter l'application) ou envoie un message vocal (🎙️).
  Aucun renvoi vers WhatsApp ni vers un autre service ; le numero reste visible des deux
  cotes (choix assume du MVP), et l'annonce concernee — titre **et lien** — est rappelee dans
  la conversation (`frontend/src/components/ContactBar.jsx`, `frontend/src/pages/Messages.jsx`).
- **Compte obligatoire pour parler** : `/ad/<id>` est protege, donc un lien partage conduit a
  l'ecran de connexion, puis **ramene sur l'annonce** (`afterLoginPath` de
  `frontend/src/lib/chat.js`) ; la conversation s'ouvre avec l'annonce en rappel et une phrase
  d'accroche pre-remplie qui contient le **lien de l'annonce** (un seul appui a envoyer, meme
  en lisant peu ; le lien est cliquable dans la bulle et rouvre l'annonce dans l'application).
- **Groupes** : nom (vocal ou texte), couverture, description vocale, public ou prive,
  publications des membres, discussions **type WhatsApp** (bulles + composer avec piece
  jointe 📎, photo 📷, vocal 🎙️ et envoi ➤ ; les messages peuvent etre du texte, un vocal,
  une photo ou un document), notifications push aux membres, moderation par l'admin
  (exclure un membre, supprimer une publication).
- **Navigation en bas (mobile)** : barre d'onglets collee en bas, facon WhatsApp — Accueil,
  Discussions, Appels, Mes annonces, Notifications — avec badges de non-lus
  (`frontend/src/components/TabBar.jsx`, regles testables dans `frontend/src/lib/nav.js`).
  Elle s'efface sur les ecrans plein ecran (publication, detail d'annonce, conversation) pour
  laisser la place au clavier. L'onglet **Appels** liste les contacts et un historique local
  des appels lances (IndexedDB : rien n'est envoye au serveur, boutons 📞 et 💬, appel par
  `tel:`). L'onglet **Notifications** affiche le journal des alertes SMS / push / vocales
  (`GET /me/notifications`), consultable hors ligne et remis a zero a l'ouverture.
- **Installation de la PWA obligatoire** : a la premiere visite, l'application n'est pas ouverte
  tant que Bodogui n'est pas installe. Un **portail plein ecran** remplace tout le site (aucun
  ecran n'apparait puis disparait, aucune requete inutile en 2G) : bouton INSTALLER sur
  Android/Chrome, instructions « Partager > Sur l ecran d'accueil » sur iPhone. Une application
  deja installee (mode autonome, `appinstalled`) entre directement ; sur un navigateur qui ne
  peut pas installer (Firefox, site en HTTP non securise), un lien discret « Ouvrir dans le
  navigateur » apparait apres quelques secondes, sinon ces visiteurs seraient bloques
  definitivement (`frontend/src/components/InstallGate.jsx`, regles dans `frontend/src/lib/pwa.js`).
  Le portail se desactive pour le developpement avec `VITE_INSTALL_GATE=off` ; dans ce cas
  l'invitation classique (non bloquante, refus repousse de 3 jours) reprend le relais.
- **Partage d'annonce** : bouton PARTAGER (WhatsApp, menu de partage du telephone, copie du
  lien). Le texte partage ne contient **que le lien** (jamais le numero du vendeur). Une
  annonce partagee **exige une inscription**, et sans compte il est impossible d'ecrire au
  vendeur : le visiteur est conduit a l'ecran de connexion, puis revient sur l'annonce.
- **Confirmations** avant toute action lourde : suppression de compte, blocage d'un
  utilisateur (boutons Annuler / Confirmer en grand). Il n'y a **pas de bouton de deconnexion** :
  le compte reste ouvert sur le telephone. La suppression de compte, irreversible, est rangee
  dans une **zone sensible repliee** en bas de « Mon compte » (libelle discret « ⚙️ Options du
  compte ») : un appui l'ouvre, un deuxieme ouvre la confirmation, le troisieme seulement
  supprime — impossible de la declencher en scrollant.
- **Changement de langue (pastilles 🌍 de « Mon compte »)** : confirme lui aussi avant de basculer.
  La question est posee **dans la langue actuelle** (on doit pouvoir la lire) et le bouton de
  droite nomme la langue visee (drapeau + nom natif, ex. « 🇹🇩 عربي »), pour rester lisible sans
  savoir lire. Le retour se fait dans la **nouvelle** langue : message « Langue changee. » et, si
  la voix est active, l'accroche d'accueil deja enregistree dans les 4 langues. Appuyer sur la
  langue deja active ne fait rien. Le tout premier choix (`/welcome`) reste direct : c'est la
  langue que l'on choisit, pas un changement.
- **Blocage utilisateur (🚫)** : propose par le signalement d'une annonce (« bloquer aussi cet
  utilisateur ») — la fiche n'a plus de bouton BLOQUER dedie. Effet : disparition des annonces,
  messages et notifications dans les deux sens, bouton "Appeler" neutralise, liste des bloques
  avec deblocage (`/blocked`).
- **Signalement + blocage** en une seule action.
- **Bannissement plateforme** (temporaire ou definitif) par un administrateur, avec SMS et
  message vocal "Votre compte a ete suspendu".
- **Confiance** : evaluations vocales apres transaction, rappels anti-arnaque
  ("ne payez jamais avant d'avoir vu le produit").
- **Hors ligne** : consultation de ses annonces, preparation d'une publication, envoi
  automatique des que la connexion revient (file IndexedDB + `client_uuid` idempotent).
- **4 langues** : francais, arabe tchadien, fulfulde, sara (interface + messages vocaux).

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploiement pas a pas sur Coolify (VPS Contabo) |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Toutes les variables d'environnement |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, schema de donnees, choix techniques |
| [docs/API.md](docs/API.md) | Reference des endpoints REST |
| [docs/BACKUPS.md](docs/BACKUPS.md) | Sauvegardes PostgreSQL vers Backblaze B2 |
| [docs/VOICE_PROMPTS.md](docs/VOICE_PROMPTS.md) | Guide d'enregistrement des messages vocaux |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Feuille de route Phase 1 / 2 / 3 |
| [ops/README.md](ops/README.md) | Taches planifiees (cron Coolify) |
| [wireframes/index.html](wireframes/index.html) | Maquettes des ecrans |

## Contraintes tenues

| Contrainte | Etat |
| --- | --- |
| Interface < 5 Mo | **473 Ko** de build total (44 Ko de JS applicatif, 16 Ko gzip) |
| Images < 100 Ko | WebP, largeur 1080 px max, qualite ajustee automatiquement |
| Audio < 50 Ko pour 30 s | Opus a 24 kbps (MediaRecorder) |
| Boutons >= 60 px | Variable CSS `--touch: 60px`, tuiles principales a 110 px |
| Hors ligne | Service worker (precache + cache medias) et file de publication |
| Aucun paiement | Non implemente (transactions en personne) |
| Aucun masquage de numero | Bouton "Appeler" direct ; le contact WhatsApp externe est retire, la discussion se tient dans l'application |
