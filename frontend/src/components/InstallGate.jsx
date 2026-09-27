import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { BigButton } from './ui.jsx';
import {
  INSTALL_GATE_ENABLED,
  INSTALL_GATE_GRACE_MS,
  INSTALL_GATE_MANDATORY,
  INSTALL_GATE_MODE,
  isIos,
  isStandalone,
  markGateBypassed,
  markInstalled,
  readInstallState,
  shouldShowInstallGate,
} from '../lib/pwa.js';

/**
 * Invitation a installer Bodogui (PWA). Le portail s'affiche plein ecran pour
 * mettre l'installation en avant : icone sur l'ecran d'accueil, ouverture en un
 * geste, notifications.
 *
 * L'installation n'est **pas obligatoire** : « Continuer dans le navigateur »
 * est toujours propose, et le refus est memorise (`bypassed`). Trois modes via
 * `VITE_INSTALL_GATE` :
 *  - `off` : aucun portail (l'invitation discrete `InstallPrompt` reprend) ;
 *  - *(defaut)* `invite` : portail non bloquant ;
 *  - `mandatory` : portail bloquant (demonstration, essai terrain) — sur iPhone
 *    et sur les navigateurs sans installation, une porte de sortie apparait
 *    apres quelques secondes, sans quoi ces visiteurs seraient bloques.
 */
export function InstallGate({ children }) {
  const { language, showToast } = useApp();
  const [standalone] = useState(() => isStandalone());
  const [ios] = useState(() => isIos());
  const [state, setState] = useState(() => readInstallState());
  const [deferred, setDeferred] = useState(null); // evenement beforeinstallprompt
  const [promptUsed, setPromptUsed] = useState(false); // installation deja proposee
  const [settled, setSettled] = useState(!INSTALL_GATE_ENABLED);
  const [busy, setBusy] = useState(false);

  // Application ouverte depuis l'icone : on memorise l'installation.
  useEffect(() => {
    if (standalone) markInstalled();
  }, [standalone]);

  useEffect(() => {
    if (!INSTALL_GATE_ENABLED) return undefined;
    const onBeforeInstall = (event) => {
      // On garde le declencheur : le bouton INSTALLER l'utilisera sur un geste.
      event.preventDefault();
      setDeferred(event);
    };
    const onInstalled = () => {
      markInstalled();
      setDeferred(null);
      setState((prev) => ({ ...prev, installed: true }));
      showToast(t(language, 'install_done'), { kind: 'success' });
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    // Certains navigateurs n'emettent jamais l'evenement : passe ce delai, on
    // affiche les instructions (iPhone) ou la porte de sortie.
    const timer = setTimeout(() => setSettled(true), INSTALL_GATE_GRACE_MS);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [language, showToast]);

  const decision = shouldShowInstallGate({
    mode: INSTALL_GATE_MODE,
    standalone,
    installed: Boolean(state.installed),
    bypassed: Boolean(state.bypassed),
    canPrompt: Boolean(deferred),
    ios,
    settled,
    promptUsed,
  });

  // Application installee (ou portail desactive) : on ouvre l'application.
  if (!decision.block) return children;

  const install = async () => {
    if (!deferred?.prompt) return;
    setBusy(true);
    try {
      deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome === 'accepted') markInstalled();
    } catch {
      // Le navigateur a refuse d'ouvrir la boite de dialogue : on garde le portail.
    } finally {
      // Le declencheur n'est utilisable qu'une fois : on bascule sur le message
      // d'installation (instructions iPhone, ou rechargement de la page pour
      // reproposer la boite de dialogue). En mode invitation, « Continuer dans le
      // navigateur » reste affiche ; il ne disparait qu'en mode mandatory.
      setDeferred(null);
      setPromptUsed(true);
      setSettled(true);
      setBusy(false);
    }
  };

  const bypass = () => {
    markGateBypassed();
    setState((prev) => ({ ...prev, bypassed: true }));
  };

  return (
    <>
      <div
        className="install-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label={t(language, 'install_title')}
      >
        <div className="install-card install-card--gate">
          <div className="install-card__logo" aria-hidden="true">B</div>
          <h2 className="install-card__title">{t(language, 'install_title')}</h2>
          <p className="install-card__message">{t(language, 'install_invite_message')}</p>

          {deferred ? (
            <BigButton
              icon="⬇️"
              label={busy ? t(language, 'loading') : t(language, 'install_button')}
              color="green"
              size="large"
              onClick={install}
            />
          ) : (
            <p className="install-card__hint">
              {ios ? `📲 ${t(language, 'install_ios_hint')}` : settled ? t(language, 'install_message') : t(language, 'loading')}
            </p>
          )}

          {decision.canEscape ? (
            INSTALL_GATE_MANDATORY ? (
              // Mode demonstration : porte de sortie discrete (iPhone / navigateur
              // sans installation), sans quoi ces visiteurs seraient bloques.
              <button type="button" className="install-card__escape" onClick={bypass}>
                {t(language, 'install_open_browser')}
              </button>
            ) : (
              // Mode invitation (defaut) : l'installation n'est pas obligatoire, la
              // sortie est donc un vrai bouton, aussi visible que INSTALLER.
              <BigButton
                icon="🌐"
                label={t(language, 'install_open_browser')}
                color="grey"
                onClick={bypass}
              />
            )
          ) : null}
        </div>
      </div>
      {/* Aucune barre d'onglets ni ecran ici : le portail remplace toute
          l'application. La confirmation "Bodogui est installe" s'affiche via le
          Toast de l'application, monte des que l'installation est terminee. */}
    </>
  );
}

export default InstallGate;
