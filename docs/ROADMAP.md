# Feuille de route Bodogui

## Phase 1 - MVP (0 a 3 mois) : realisee dans ce depot

Objectif : prouver que des vendeurs et acheteurs non lecteurs peuvent conclure une
transaction reelle avec Bodogui, a N'Djamena (quartiers Moursal, Chagoua, Dembe).

| Livrable | Etat |
| --- | --- |
| PWA React installable, < 5 Mo, hors ligne en mode degrade | Fait (473 Ko de build) |
| API Node.js + PostgreSQL + Redis auto-heberges via Coolify (VPS Contabo) | Fait |
| Inscription par telephone + code SMS (sans email, sans mot de passe) | Fait |
| Publication en 5 gestes (photos, voix, prix, categorie) — quartier facultatif | Fait |
| Suppression du choix "je vends / je cherche" dans l'assistant (boutons ambigus) | Fait |
| Recherche par categorie, quartier, prix + recherche vocale (repli categories) | Fait |
| Quartier du profil choisi une fois dans "Mon compte" (facultatif, effacable) | Fait |
| Vue detaillee avec ecoute du vocal et appel direct (sans masquage) | Fait |
| Conversation interne acheteur/vendeur (texte ou vocal, sans renvoi vers WhatsApp) | Fait |
| Compte obligatoire pour parler a un vendeur (lien partage -> inscription -> retour sur l'annonce) | Fait |
| Correction (✏️) et suppression (🗑️) de son annonce depuis la fiche | Fait |
| Groupes publics/prives avec moderation par l'admin | Fait |
| Blocage utilisateur (🚫, propose par le signalement) et liste des bloques | Fait |
| Signalement + proposition de blocage, bannissement plateforme | Fait |
| Notifications SMS (Africa's Talking) et push PWA | Fait |
| Evaluations vocales apres transaction | Fait |
| Maquettes, documentation de deploiement, sauvegardes B2 | Fait |

Reste a faire cote terrain (hors code) pour lancer le pilote :

1. Acheter le domaine `bodogui.com` et le VPS Contabo, deployer via Coolify.
2. Ouvrir un compte Africa's Talking (expediteur `BODOGUI`) et verifier l'envoi vers le Tchad.
3. Creer le bucket Backblaze B2 + le domaine CDN Cloudflare.
4. Enregistrer les messages vocaux avec des natifs (voir `docs/VOICE_PROMPTS.md`).
5. Recruter 2 moderateurs locaux et 20 vendeurs pilotes (betail, motos, telephones).
6. Distribuer des cartes SIM de test et former les vendeurs en 30 minutes avec l'application.

Indicateurs de succes a mesurer pendant le pilote : nombre d'annonces publiees par semaine,
taux d'annonces avec message vocal, nombre d'appels declenches depuis l'application, nombre
de transactions declarees "vendues", taux d'installation de la PWA.

## Phase 2 (6 a 12 mois)

- Application Android legere (WebView optimise ou React Native) pour les telephones sans
  Chrome recent, avec mise a jour auto.
- Notifications push enrichies et optimisation de la consommation batterie.
- Speech-to-Text (Whisper auto-heberge) pour la recherche vocale reelle et l'indexation des
  annonces vocales.
- Mode "plusieurs langues par annonce" et detection automatique de la langue du vocal.
- Statistiques vendeur et badges de confiance avances (anciennete, volume, evaluations).
- Extension aux villes de Moundou, Sarh et Abeche (nouveaux quartiers et numeros locaux).
- Moderation assistee : detection automatique des prix anormalement bas, des doublons et des
  numeros deja bannis.
- Reduction du RPO des sauvegardes (archivage WAL continu vers B2).

## Phase 3 (12 a 24 mois)

- Expansion Cameroun, Niger, Mali, Burkina Faso : prefixes telephoniques, devises, langues
  (fulfulde, haoussa, bambara) et passerelles SMS locales.
- IA de recommandation (annonces proches, prix du marche par categorie et par quartier,
  alertes personnalisees par SMS).
- Partenariats cooperatives, ONG et associations de commercants (groupes verifies, cautions).
- Marketplace de confiance : profils professionnels verifies, historique de transactions.
- Option IVR (appel automatique) pour les feature phones : publication d'annonce 100 % par
  appel telephonique.
- Application Android sur le Play Store et distribution via les operateurs locaux.
