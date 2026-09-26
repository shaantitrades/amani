/**
 * Logique de l'assistant de publication (pure, testable).
 *
 * Regle de conception : chaque etape doit toujours offrir une action de sortie.
 * L'etape "categorie" a longtemps avance automatiquement apres un appui (200 ms),
 * ce qui bloquait l'utilisateur si la liste des categories n'etait pas chargee
 * et permettait aussi de sauter l'etape suivante en cas de double appui.
 * Desormais, chaque etape a un bouton explicite.
 *
 * L'etape "location" (GPS + grille de quartiers) a ete retiree de l'assistant :
 * au Tchad, beaucoup de vendeurs (bergers, zones rurales ou desertiques) ne sont
 * rattaches a aucun quartier du referentiel, et la question du lieu bloquait la
 * publication. Le quartier du profil (ou du groupe) est repris silencieusement
 * quand il existe, sinon l'annonce est publiee sans quartier : c'est le texte ou
 * le message vocal du vendeur qui situe le lieu.
 *
 * L'etape "kind" ("JE VENDS" / "JE CHERCHE") a egalement ete retiree : deux
 * boutons presque identiques egarent les vendeurs qui ne lisent pas (et les
 * annonces "je cherche" sont tres rares au Tchad). Toute annonce publiee depuis
 * l'application est donc une vente (`kind: 'sell'`). Le champ reste accepte,
 * renvoye et filtrable cote serveur (`GET /ads?kind=`) pour ne pas casser les
 * annonces existantes.
 */

export const SELL_STEPS = ['photos', 'description', 'price', 'category', 'summary'];

/** Etapes qui ne peuvent pas etre quittees sans choix (bouton desactive sinon). */
export const STEPS_REQUIRING_CHOICE = ['price', 'category'];

export function stepId(index) {
  return SELL_STEPS[Math.max(0, Math.min(SELL_STEPS.length - 1, index))];
}

export function stepPosition(index) {
  const safe = Math.max(0, Math.min(SELL_STEPS.length - 1, index));
  return { index: safe, number: safe + 1, total: SELL_STEPS.length, id: SELL_STEPS[safe] };
}

/** Etape suivante (borne a la derniere : on ne sort jamais de l'assistant). */
export function nextStepIndex(index) {
  return Math.min(SELL_STEPS.length - 1, Math.max(0, index) + 1);
}

/** Etape precedente (0 reste 0 : la sortie se fait par le bouton retour). */
export function prevStepIndex(index) {
  return Math.max(0, Math.min(SELL_STEPS.length - 1, index) - 1);
}

/**
 * Peut-on passer a l'etape suivante depuis `id` avec ce brouillon ?
 *
 * L'etape "description" (voix, titre, texte) est toujours franchissable :
 * la voix n'est jamais obligatoire, l'annonce peut ne porter que des photos,
 * un prix et une categorie.
 *
 * @param {string} id identifiant d'etape
 * @param {{photos?: any[], audio?: any, description_text?: string, title?: string,
 *          price_amount?: string|number, category_id?: string}} draft
 */
export function canContinueStep(id, draft = {}) {
  switch (id) {
    case 'description':
      return true; // voix, titre et texte facultatifs
    case 'price':
      return draft.price_amount !== '' && draft.price_amount !== null && draft.price_amount !== undefined;
    case 'category':
      return Boolean(draft.category_id);
    default:
      return true; // photos, summary : pas de blocage
  }
}

/**
 * Un brouillon est-il publiable ? (miroir des controles serveur)
 * Seule la categorie est exigee : la description vocale, le titre, le texte et
 * le quartier restent facultatifs (beaucoup de vendeurs hors des quartiers du
 * referentiel). Le serveur accepte donc `district_id` absent.
 * @returns {{ok: boolean, missing: string[]}}
 */
export function validateDraft(draft = {}) {
  const missing = [];
  if (!draft.category_id) missing.push('category_id');
  return { ok: missing.length === 0, missing };
}

export default {
  SELL_STEPS,
  STEPS_REQUIRING_CHOICE,
  stepId,
  stepPosition,
  nextStepIndex,
  prevStepIndex,
  canContinueStep,
  validateDraft,
};
