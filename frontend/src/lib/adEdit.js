/**
 * Aide a la modification d'une annonce publiee (bouton "Modifier").
 *
 * L'assistant de publication sert aussi a corriger une annonce existante : ce
 * module prepare le brouillon a partir de l'annonce du serveur, puis construit
 * le corps de la requete PATCH. Ces regles vivent ici (et non dans l'ecran)
 * parce qu'une erreur se paie cher : une liste de photos mal separee ferait
 * perdre les photos du vendeur, et un champ vide envoye par erreur effacerait
 * son prix.
 */

/** Vrai pour une photo deja stockee : aucun fichier a envoyer au serveur. */
export function isStoredPhoto(photo) {
  return Boolean(photo?.storage_key) && !photo?.blob && !photo?.file;
}

/** Separe les photos conservees des photos a envoyer (nouvellement prises). */
export function splitPhotos(photos = []) {
  const stored = [];
  const fresh = [];
  for (const photo of photos) {
    if (isStoredPhoto(photo)) {
      stored.push({ storage_key: photo.storage_key, thumb_key: photo.thumb_key || null });
    } else if (photo) {
      fresh.push(photo);
    }
  }
  return { stored, fresh };
}

/**
 * Brouillon de l'assistant pre-rempli avec une annonce du serveur.
 * Les photos deja publiees sont reconnues par leur `storage_key` (le selecteur
 * les affiche via /media) : rien n'est re-televerse tant qu'elles sont gardees.
 */
export function draftFromAd(ad = {}) {
  const price = ad.price_amount === null || ad.price_amount === undefined ? '' : String(ad.price_amount);
  return {
    title: ad.title || '',
    description_text: ad.description_text || '',
    price_amount: price,
    category_id: ad.category_id || '',
    photos: (ad.photos || []).map((photo) => ({
      storage_key: photo.storage_key,
      thumb_key: photo.thumb_key || null,
      name: photo.storage_key,
    })),
  };
}

/**
 * Corps de la requete `PATCH /ads/:id`.
 *
 * Les valeurs vides deviennent `null` (prix retire, titre efface) : le serveur
 * distingue "champ absent" (inchange) de "champ vide" (efface). La categorie
 * n'est jamais envoyee vide, la colonne etant obligatoire en base.
 * La voix existante n'est remplacee que si un nouvel enregistrement est fourni.
 */
export function editPayload(draft = {}, { photos = [], audio = null } = {}) {
  const { stored } = splitPhotos(draft.photos);
  const title = (draft.title || '').trim();
  const text = (draft.description_text || '').trim();
  const empty = draft.price_amount === '' || draft.price_amount === null || draft.price_amount === undefined;

  const body = {
    title: title || null,
    description_text: text || null,
    price_amount: empty ? null : Number(draft.price_amount),
    photos: [...stored, ...photos],
  };
  if (draft.category_id) body.category_id = draft.category_id;
  if (audio?.key) {
    body.description_audio_key = audio.key;
    body.description_audio_seconds = audio.seconds ?? null;
    body.description_transcript = audio.transcript || null;
  }
  return body;
}

export default { draftFromAd, editPayload, isStoredPhoto, splitPhotos };
