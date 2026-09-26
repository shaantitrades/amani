# Messages vocaux du systeme : guide d'enregistrement

Bodogui parle a ses utilisateurs. Chaque action (publication, blocage, erreur...) est
confirmee par une phrase enregistree par un **natif**, pour que les personnes qui ne lisent
pas puissent utiliser l'application seules.

## Comment ca fonctionne

1. Le client demande `/voice/<langue>/<cle>.opus`.
2. Le backend sert le fichier depuis le stockage (`backend/src/services/voice.js` contient le
   catalogue et les scripts).
3. Si le fichier n'existe pas encore, le client joue la **synthese vocale** du navigateur,
   puis un **bip** : jamais de silence.

Les cles sont identiques dans `backend/src/services/voice.js` et
`frontend/src/i18n/strings/voice.js` (un test verifie leur coherence).

## Arborescence a produire

```
voice/
  fr/   accueil.opus ...
  ar/
  ff/
  sar/
```

Les fichiers doivent etre deposes dans le stockage objet sous la cle
`voice/<langue>/<cle>.opus` (MinIO en developpement, Backblaze B2 en production), puis
accessibles via `/voice/<langue>/<cle>.opus`. Le service worker les met en cache 90 jours.

## Contraintes techniques

| Contrainte | Valeur |
| --- | --- |
| Format | Opus dans un conteneur Ogg (`.opus`) |
| Debit | 24 kbps mono (comme les messages des utilisateurs) |
| Frequence | 48 kHz (ou 16 kHz, la voix suffit) |
| Duree | 2 a 6 secondes par message |
| Loudness | -16 LUFS (uniformiser entre enregistreurs) |
| Bruit de fond | Aucun (interieur calme, pas de vent) |

Exemple d'encodage :

```bash
ffmpeg -i prise.wav -c:a libopus -b:a 24k -ar 48000 -ac 1 -application voip fr/ad_published.opus
```

Verification :

```bash
ffprobe -hide_banner fr/ad_published.opus    # doit indiquer "opus" et ~24 kb/s
```

## Liste des messages a enregistrer

### Parcours d'inscription et navigation

| Cle | Script francais (a adapter, pas a traduire mot a mot) |
| --- | --- |
| `welcome` | Bienvenue sur Bodogui. Vendez et achetez pres de chez vous. |
| `choose_language` | Choisissez votre langue. |
| `call_started` | Appel en cours. |
| `safety_warning` | Ne payez jamais avant d'avoir vu le produit. |

### Publication

| Cle | Script |
| --- | --- |
| `photo_added` | Photo ajoutee. |
| `photos_done` | Photos terminees. |
| `recording_start` | Parlez maintenant. |
| `recording_stop` | Message enregistre. |
| `price_saved` | Prix enregistre. |
| `location_saved` | Localisation enregistree. |
| `category_selected` | Categorie choisie. |
| `ad_published` | Votre annonce est publiee. Vous recevrez un SMS si quelqu'un est interesse. |
| `ad_saved_offline` | Pas de reseau. Votre annonce sera publiee des que la connexion revient. |
| `ad_sold` | Annonce marquee comme vendue. Felicitations. |
| `ad_deleted` | Annonce supprimee. |
| `ad_updated` | Annonce modifiee. |

### Contact, confiance et moderation

| Cle | Script |
| --- | --- |
| `interest_sent` | Votre message vocal a ete envoye au vendeur. |
| `new_message` | Nouveau message recu. |
| `reported` | Signalement envoye. Merci de nous aider a proteger la communaute. |
| `reported_and_blocked` | Signalement envoye et utilisateur bloque. |
| `report_and_block` | Voulez-vous aussi bloquer cet utilisateur ? |
| `blocked` | Utilisateur bloque. Vous ne verrez plus ses annonces. |
| `unblocked` | Utilisateur debloque. |
| `account_banned` | Votre compte a ete suspendu. Contactez le support. |
| `profile_saved` | Profil enregistre. |
| `rating_saved` | Merci pour votre evaluation. |

### Groupes

| Cle | Script |
| --- | --- |
| `group_created` | Groupe cree. Vous etes administrateur. |
| `group_joined` | Vous avez rejoint le groupe. |
| `group_left` | Vous avez quitte le groupe. |
| `group_post` | Nouvelle annonce dans le groupe. |
| `member_banned` | Membre exclu du groupe. |
| `post_deleted` | Publication supprimee. |

### Recherche et erreurs

| Cle | Script |
| --- | --- |
| `nothing_found` | Aucune annonce trouvee. Essayez une autre categorie. |
| `voice_search_hint` | Dites ce que vous cherchez. |
| `synced` | Annonces synchronisees. |
| `error_generic` | Une erreur est survenue. Reessayez. |
| `error_phone_invalid` | Ce numero de telephone n'est pas correct. |
| `error_code_invalid` | Le code est incorrect. |
| `error_code_expired` | Le code a expire. Demandez un nouveau code. |
| `error_code_rate_limited` | Trop de demandes de code. Patientez une heure. |
| `error_offline` | Pas de connexion internet. |
| `error_audio_empty` | Le message vocal est vide. |
| `error_audio_too_long` | Le message vocal est trop long. Parlez moins de soixante secondes. |
| `error_audio_short` | Enregistrement trop court. Parlez un peu plus longtemps. |
| `error_mic_denied` | Le micro est bloque. Autorisez le micro dans votre navigateur. |
| `error_mic_missing` | Aucun micro detecte sur cet appareil. |
| `error_mic_busy` | Le micro est utilise par une autre application. |
| `error_gps_denied` | Position refusee. Choisissez votre quartier. |
| `error_gps_unavailable` | Position indisponible. Choisissez votre quartier. |
| `error_gps_timeout` | Position introuvable. Choisissez votre quartier. |
| `error_insecure_context` | Le micro et la position exigent une page securisee (https ou localhost). |
| `error_too_many_photos` | Trop de photos. Maximum six. |
| `error_description_required` | Ajoutez une description ou un titre. |
| `error_blocked_target` | Cet utilisateur est bloque. |
| `error_rate_limited` | Trop de demandes. Patientez un instant. |
| `error_forbidden` | Action interdite. |

Le catalogue complet et executable est genere par `GET /api/v1/voice/manifest` :
il renvoie, pour chaque langue, la liste des cles et le script francais correspondant.

> Note : les messages de localisation (`use_gps`, `choose_district`, `location_saved`,
> `gps_accuracy`, `error_gps_*`) restent dans le catalogue mais ne sont plus declenches par
> l'interface : l'etape de lieu a ete retiree de la publication (les vendeurs hors du
> referentiel des quartiers publient sans quartier). Ils sont conserves pour une future
> recherche "pres de moi".

## Conseils de production

- Enregistrez avec la **voix d'un habitant du quartier pilote** (N'Djamena) : la familiarite
  de l'accent est un facteur de confiance.
- Utilisez les mots reellement employes localement pour les prix ("mille", "cent mille")
  plutot qu'une formulation administrative.
- Pour l'arabe tchadien, evitez l'arabe standard : utilisez le dialecte local.
- Verifiez chaque message avec 3 personnes du quartier avant diffusion (comprehension en
  aveugle : le message doit suffire, sans l'ecran).
- Versionnez les fichiers : `voice/<langue>/<cle>.v2.opus` en cas de correction (le service
  worker met en cache 90 jours).
- Conservez les sources (WAV + script signe par le locuteur) hors ligne : ils servent de
  reference en cas de litige.
