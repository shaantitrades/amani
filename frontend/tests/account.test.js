import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DANGER_HIDDEN,
  DANGER_REVEALED,
  isDangerOpen,
  languageChangeRequest,
  languageConfirmMessage,
  toggleDanger,
} from '../src/lib/account.js';

test('le bouton de suppression de compte est cache par defaut', () => {
  // Aucun etat (rendu initial, etat inconnu) ne doit afficher le bouton
  assert.equal(isDangerOpen(), false);
  assert.equal(isDangerOpen(null), false);
  assert.equal(isDangerOpen(DANGER_HIDDEN), false);
  assert.equal(isDangerOpen('autre chose'), false);
  assert.equal(isDangerOpen(DANGER_REVEALED), true);
});

test('un appui isole n ouvre la zone sensible que pour la montrer', () => {
  const opened = toggleDanger(DANGER_HIDDEN);
  assert.equal(opened, DANGER_REVEALED);
  assert.equal(isDangerOpen(opened), true);
  // Le geste suivant referme la zone : l'appui accidentel ne supprime rien
  assert.equal(toggleDanger(opened), DANGER_HIDDEN);
  assert.equal(isDangerOpen(toggleDanger(opened)), false);
  // L'etat par defaut de toggleDanger est bien « masque »
  assert.equal(toggleDanger(), DANGER_REVEALED);
});

test('l ecran Mon compte n a plus de bouton de deconnexion', () => {
  // Regression : la deconnexion a ete retiree de l'interface (l'API
  // /auth/logout reste disponible pour un client tiers).
  const source = readFileSync(new URL('../src/pages/Account.jsx', import.meta.url), 'utf8');
  assert.ok(!source.includes("setSheet('logout')"), 'bouton de deconnexion encore present');
  assert.ok(!source.includes("'confirm_logout'"), 'confirmation de deconnexion encore presente');
  assert.ok(!source.includes("'logout_done'"), 'message de deconnexion encore present');
  // `logout()` reste utilise par la suppression de compte (purge des jetons)
  assert.match(source, /await logout\(\)/);
});

test('la suppression de compte reste cachee derriere la zone sensible', () => {
  const source = readFileSync(new URL('../src/pages/Account.jsx', import.meta.url), 'utf8');
  // Le bouton n'existe dans la page que si la zone est ouverte...
  assert.match(source, /\{isDangerOpen\(danger\) \?/);
  // ... et l'ecran ne mentionne plus la suppression avant l'ouverture de la zone :
  // aucun gros bouton rouge en acces direct.
  const beforeZone = source.split('isDangerOpen')[0];
  assert.ok(
    !beforeZone.includes("'delete_account'"),
    'bouton de suppression accessible sans ouvrir la zone sensible',
  );
  // La zone sensible est le dernier bloc de l'ecran, et annuler la confirmation
  // referme la zone (le bouton disparait de nouveau).
  assert.match(source, /account-section--danger/);
  assert.match(source, /setDanger\(DANGER_HIDDEN\)/);
});

test('changer de langue demande une confirmation', () => {
  // Langue deja active : rien a demander, l'appui ne fait rien
  assert.equal(languageChangeRequest('fr', 'fr'), null);
  assert.equal(languageChangeRequest('ar', 'ar'), null);
  // Autre langue : on confirme avant de basculer
  assert.equal(languageChangeRequest('fr', 'ar'), 'ar');
  assert.equal(languageChangeRequest('fr', 'ff'), 'ff');
  assert.equal(languageChangeRequest('ff', 'fr'), 'fr');
  // Garde-fous : choix vide, absent ou non renseigne
  assert.equal(languageChangeRequest('fr', undefined), null);
  assert.equal(languageChangeRequest('fr', null), null);
  assert.equal(languageChangeRequest('fr', ''), null);
});

test('la confirmation de langue nomme la langue visee', () => {
  const fr = 'Changer la langue en {language} ?';
  assert.equal(languageConfirmMessage(fr, 'Fulfulde'), 'Changer la langue en Fulfulde ?');
  assert.equal(languageConfirmMessage(fr, 'عربي'), 'Changer la langue en عربي ?');
  assert.equal(languageConfirmMessage(fr, 'Arabe tchadien'), 'Changer la langue en Arabe tchadien ?');
  // Le placeholder ne doit jamais rester a l'ecran, ni deux espaces d'affilee
  assert.ok(!languageConfirmMessage(fr, 'Fulfulde').includes('{language}'));
  assert.equal(languageConfirmMessage(fr, ''), 'Changer la langue en ?');
  // Libelle absent : chaine vide plutot qu'un plantage
  assert.equal(languageConfirmMessage(undefined, 'Fulfulde'), '');
});

test('les pastilles de langue ne basculent plus la langue directement', () => {
  const source = readFileSync(new URL('../src/pages/Account.jsx', import.meta.url), 'utf8');
  // Regression : l'appui sur une pastille ouvre la confirmation, il ne change
  // plus la langue tout seul.
  assert.ok(!source.includes('onClick={() => setLanguage(item.code)}'), 'changement direct encore present');
  assert.match(source, /onClick=\{\(\) => setNextLanguage\(languageChangeRequest\(language, item\.code\)\)\}/);
  // `setLanguage` n'est appele qu'apres confirmation
  assert.match(source, /const confirmLanguage = \(\) => \{[\s\S]*?setLanguage\(code\)/);
  // La confirmation nomme la langue visee (drapeau + nom natif)
  assert.match(source, /confirmLabel=\{targetLanguage\?\.native\}/);
});

