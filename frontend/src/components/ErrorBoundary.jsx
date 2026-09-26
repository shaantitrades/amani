/**
 * Filet de securite global : si une erreur JavaScript survient dans l'interface,
 * on affiche un ecran utilisable (message vocal + bouton Recharger) au lieu
 * d'une page blanche, ce qui serait incompréhensible pour un utilisateur
 * non lecteur.
 *
 * Aucun hook n'est utilise ici (classe React) : le composant doit pouvoir
 * s'afficher meme si le contexte applicatif est en erreur.
 */
import { Component } from 'react';
import { isSupportedLanguage, t } from '../i18n/index.js';
import { announce } from '../lib/voice.js';
import { BigButton } from './ui.jsx';

const LANG_KEY = 'bodogui.language';

function currentLanguage() {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    return isSupportedLanguage(stored) ? stored : 'fr';
  } catch {
    return 'fr';
  }
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, language: currentLanguage() };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Trace conservee pour le support terrain et le monitoring
    console.error('[bodogui] erreur interface :', error, info?.componentStack);
    announce('error_generic');
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const language = currentLanguage();
    return (
      <div className="screen">
        <div className="crash">
          <div className="crash__icon" aria-hidden="true">⚠️</div>
          <h1 className="crash__title">{t(language, 'app_name')}</h1>
          <p className="crash__message">{t(language, 'error_generic') || 'Une erreur est survenue. Reessayez.'}</p>

          <BigButton
            icon="🔄"
            label={t(language, 'sync_now')}
            color="green"
            size="large"
            onClick={() => window.location.reload()}
          />
          <BigButton
            icon="🏠"
            label={t(language, 'account')}
            color="grey"
            onClick={() => {
              window.location.href = '/';
            }}
          />

          <details className="crash__detail">
            <summary>Details techniques</summary>
            <pre>{String(error?.message || error)}</pre>
            <p>
              Si le probleme persiste : verifiez la connexion internet, puis signalez le message ci-dessus au
              support Bodogui.
            </p>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
