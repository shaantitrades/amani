import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SELL_STEPS,
  STEPS_REQUIRING_CHOICE,
  canContinueStep,
  nextStepIndex,
  prevStepIndex,
  stepId,
  stepPosition,
  validateDraft,
} from '../src/lib/wizard.js';

/**
 * Regression : l'etape 5/7 (categorie) bloquait l'utilisateur car elle ne
 * proposait aucune action de sortie (avance automatique uniquement).
 * L'etape "location" a ete retiree : le lieu n'est plus demande au vendeur.
 * L'etape "kind" a ete retiree : le choix "JE VENDS / JE CHERCHE" egare les
 * vendeurs qui ne lisent pas, toute annonce publiee est une vente.
 */
test("l'assistant de publication compte 5 etapes dans l'ordre attendu", () => {
  assert.deepEqual(SELL_STEPS, ['photos', 'description', 'price', 'category', 'summary']);
  assert.equal(SELL_STEPS.includes('location'), false, "l'etape localisation a ete retiree");
  assert.equal(SELL_STEPS.includes('kind'), false, "le choix je vends / je cherche a ete retire");
  assert.equal(stepPosition(3).number, 4);
  assert.equal(stepPosition(3).total, 5);
  assert.equal(stepPosition(3).id, 'category');
});

test('la progression ne sort jamais des bornes', () => {
  assert.equal(nextStepIndex(0), 1);
  assert.equal(nextStepIndex(4), 4); // derniere etape : on ne depasse pas
  assert.equal(nextStepIndex(9), 4);
  assert.equal(prevStepIndex(0), 0); // premiere etape : le retour ferme l'assistant
  assert.equal(prevStepIndex(3), 2);
  assert.equal(stepId(99), 'summary');
  assert.equal(stepId(-5), 'photos');
});

test('chaque etape exigeante a une validation explicite possible', () => {
  const empty = {};
  for (const id of STEPS_REQUIRING_CHOICE) {
    assert.equal(canContinueStep(id, empty), false, `${id} devrait etre bloquee sans choix`);
    assert.equal(canContinueStep(id, filledDraft()), true, `${id} devrait etre validable`);
  }
});

test('les etapes sans choix obligatoire laissent toujours passer', () => {
  for (const id of ['photos', 'summary']) {
    assert.equal(canContinueStep(id, {}), true);
  }
  // Garde-fou : un identifiant d'etape inconnu (ou une ancienne etape retiree)
  // ne doit jamais bloquer la publication.
  assert.equal(canContinueStep('kind', {}), true);
});

test('l\'etape categorie se valide des qu\'une categorie est choisie', () => {
  assert.equal(canContinueStep('category', { category_id: '' }), false);
  assert.equal(canContinueStep('category', { category_id: 'uuid-1234' }), true);
});

test('l\'etape prix accepte 0 mais pas une valeur absente', () => {
  assert.equal(canContinueStep('price', { price_amount: 0 }), true);
  assert.equal(canContinueStep('price', { price_amount: '0' }), true);
  assert.equal(canContinueStep('price', { price_amount: '' }), false);
  assert.equal(canContinueStep('price', {}), false);
});

test('l\'etape description est entierement facultative (voix non obligatoire)', () => {
  // Regression : le bouton de validation etait desactive sans voix, titre ou
  // texte, ce qui bloquait les vendeurs qui voulaient publier des photos seules.
  assert.equal(canContinueStep('description', {}), true);
  assert.equal(canContinueStep('description', { audio: { blob: 'x' } }), true);
  assert.equal(canContinueStep('description', { title: 'Vache' }), true);
  assert.equal(canContinueStep('description', { description_text: 'Deux ans, bonne laitiere' }), true);
  assert.equal(STEPS_REQUIRING_CHOICE.includes('description'), false);
});

test('validateDraft n\'exige ni voix, ni texte, ni titre', () => {
  assert.deepEqual(validateDraft({}).missing, ['category_id']);
  assert.equal(validateDraft({ category_id: 'c' }).ok, true);
  assert.equal(validateDraft(filledDraft()).ok, true);
});

test('une annonce est publiable sans quartier (vendeurs hors referentiel)', () => {
  // Regression : le quartier etait exige, ce qui bloquait les bergers et les
  // vendeurs des zones rurales ou desertiques du Tchad, absents du referentiel.
  const draft = { category_id: 'c1', price_amount: '250000', district_id: '' };
  assert.deepEqual(validateDraft(draft), { ok: true, missing: [] });
  assert.equal(canContinueStep('location', draft), true, 'plus aucune etape de lieu ne bloque');
  assert.equal(STEPS_REQUIRING_CHOICE.includes('location'), false);
});

function filledDraft() {
  return {
    category_id: 'c1',
    district_id: 'd1',
    audio: { blob: 'x' },
    price_amount: '1000',
  };
}
