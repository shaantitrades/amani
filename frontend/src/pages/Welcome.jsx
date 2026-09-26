import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { LANGUAGES, t } from '../i18n/index.js';
import { announce } from '../lib/voice.js';
import { BigButton } from '../components/ui.jsx';

/**
 * Premier lancement : choix de la langue avec drapeaux + echantillon audio.
 * Aucun texte n'est indispensable : chaque bouton joue la phrase d'accueil.
 */
export default function Welcome() {
  const { language, setLanguage, authenticated, user } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    if (authenticated && user) navigate('/home', { replace: true });
  }, [authenticated, user, navigate]);

  const choose = async (code) => {
    setLanguage(code);
    await announce('welcome');
  };

  const start = () => {
    announce('welcome');
    navigate(authenticated ? '/home' : '/login', { replace: true });
  };

  return (
    <div className="screen screen--welcome">
      <div className="welcome__logo" aria-hidden="true">
        <span>B</span>
      </div>
      <h1 className="welcome__title">{t(language, 'app_name')}</h1>
      <p className="welcome__tagline">{t(language, 'tagline')}</p>

      <h2 className="welcome__section">{t(language, 'choose_language')}</h2>
      <div className="lang-grid">
        {LANGUAGES.map((item) => (
          <button
            key={item.code}
            type="button"
            className={`lang-tile ${language === item.code ? 'lang-tile--active' : ''}`}
            onClick={() => choose(item.code)}
          >
            <span className="lang-tile__flag" aria-hidden="true">{item.flag}</span>
            <span className="lang-tile__native">{item.native}</span>
            <span className="lang-tile__label">{item.label}</span>
            <span className="lang-tile__sound" aria-hidden="true">🔊</span>
          </button>
        ))}
      </div>

      <BigButton icon="▶️" label={t(language, 'start')} color="green" size="large" onClick={start} />
    </div>
  );
}
