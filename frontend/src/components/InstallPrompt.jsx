import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { BigButton } from './ui.jsx';
import {
  isIos,
  isStandalone,
  markDismissed,
  markInstalled,
  readInstallState,
  shouldShowInstallPrompt,
} from '../lib/pwa.js';

/**
 * Invitation a installer Bodogui, affichee **au milieu de l'ecran** (visible du
 * premier coup d'oeil, comme le souhaitent les utilisateurs qui arrivent depuis
 * un lien partage sur WhatsApp).
 *
 * Regles :
 *  - jamais affichee si Bodogui est deja installe (mode autonome, evenement
 *    `appinstalled`, ou installation detectee lors d'une visite precedente) ;
 *  - affichee uniquement si le navigateur sait installer (Android/Chrome) ou
 *    avec les instructions manuelles sur iPhone ;
 *  - apres un refus, on ne la repropose qu'apres quelques jours.
 */
export function InstallPrompt() {
  const { language, showToast } = useApp();
  const [deferred, setDeferred] = useState(null); // evenement beforeinstallprompt
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = readInstallState();
    const standalone = isStandalone();
    const isApple = isIos();
    setIos(isApple);

    // Deja installe : on memorise et on n'affiche rien.
    if (standalone) markInstalled();

    const decide = (canPrompt) =>
      shouldShowInstallPrompt({
        standalone,
        installed: Boolean(stored.installed),
        dismissedAt: stored.dismissedAt || null,
        canPrompt,
        ios: isApple,
      });

    // iPhone : pas d'API d'installation -> on affiche directement les instructions
    setVisible(decide(false).show && isApple);

    const onBeforeInstall = (event) => {
      event.preventDefault();
      setDeferred(event);
      setVisible(decide(true).show);
    };
    const onInstalled = () => {
      markInstalled();
      setDeferred(null);
      setVisible(false);
      showToast(t(language, 'install_done'), { kind: 'success' });
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [language, showToast]);

  const install = async () => {
    if (!deferred?.prompt) return;
    setBusy(true);
    try {
      deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome === 'accepted') markInstalled();
      else markDismissed();
    } catch {
      markDismissed();
    } finally {
      setDeferred(null);
      setBusy(false);
      setVisible(false);
    }
  };

  const later = () => {
    markDismissed();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="install-backdrop" role="dialog" aria-modal="true" aria-label={t(language, 'install_title')}>
      <div className="install-card">
        <div className="install-card__logo" aria-hidden="true">B</div>
        <h2 className="install-card__title">{t(language, 'install_title')}</h2>
        <p className="install-card__message">{t(language, 'install_message')}</p>

        {deferred ? (
          <BigButton
            icon="⬇️"
            label={busy ? t(language, 'loading') : t(language, 'install_button')}
            color="green"
            size="large"
            onClick={install}
          />
        ) : (
          <p className="install-card__hint">📲 {t(language, 'install_ios_hint')}</p>
        )}

        <BigButton icon="⏰" label={t(language, 'install_later')} color="grey" onClick={later} />
      </div>
    </div>
  );
}

export default InstallPrompt;
