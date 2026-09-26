import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { BigButton } from './ui.jsx';
import {
  INSTALL_GATE_ENABLED,
  INSTALL_GATE_GRACE_MS,
  isIos,
  isStandalone,
  markGateBypassed,
  markInstalled,
  readInstallState,
  shouldShowInstallGate,
} from '../lib/pwa.js';

/**
 * Portail d'installation : tant que Bodogui n'est pas installe, l'application
 * n'est **pas montee du tout** (aucun ecran qui apparait puis disparait, aucun
 * appel reseau inutile en 2G). L'installation est obligatoire : c'est elle qui
 * donne l'icone sur l'ecran d'accueil, l'ouverture en un geste et les
 * notifications.
 *
 * Trois cas :
 *  - Android/Chrome (et navigateurs de bureau recents) : bouton INSTALLER qui
 *    ouvre la boite de dialogue native ;
 *  - iPhone : instructions manuelles (Partager > Sur l ecran d'accueil) ;
 *  - navigateur sans installation (Firefox, HTTP non securise) : apres quelques
 *    secondes, un lien discret permet de continuer dans le navigateur — sans
 *    lui, ces visiteurs seraient definitivement bloques.
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
    enabled: INSTALL_GATE_ENABLED,
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
      // d'installation. L'installation restant obligatoire, aucune porte de
      // sortie n'est proposee ici (recharger la page la repropose).
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
          <p className="install-card__message">{t(language, 'install_required_message')}</p>

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
            <button type="button" className="install-card__escape" onClick={bypass}>
              {t(language, 'install_open_browser')}
            </button>
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
