import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { homeFeedQuery } from '../lib/feed.js';
import { cacheGet, cacheSet } from '../lib/idb.js';
import { formatPhone } from '../lib/format.js';
import { BigButton, EmptyState, OfflineBanner, Spinner, TopBar } from '../components/ui.jsx';
import { AdCard } from '../components/AdCard.jsx';

/**
 * Ecran d'accueil : quatre grandes tuiles (Vendre / Acheter / Groupes / Compte)
 * puis les dernieres annonces pres de chez vous.
 */
export default function Home() {
  const { language, user, meta, online, showToast, toggleVoice, voiceEnabled } = useApp();
  const navigate = useNavigate();
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(homeFeedQuery(user), {
        auth: false,
      });
      setAds(data.items || []);
      await cacheSet('feed:home', data);
    } catch {
      const cached = await cacheGet('feed:home');
      if (cached) setAds(cached.items || []);
      else showToast(t(language, 'error_offline'), { kind: 'error', voiceKey: 'error_offline' });
    } finally {
      setLoading(false);
    }
  }, [language, showToast, user?.district_id]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  return (
    <div className="screen">
      <TopBar
        title={t(language, 'app_name')}
        subtitle={user ? formatPhone(user.phone) : undefined}
        right={
          <>
            <button
              type="button"
              className="topbar__toggle"
              onClick={() => toggleVoice()}
              aria-label={t(language, 'settings')}
            >
              {voiceEnabled ? '🔊' : '🔇'}
            </button>
            <Link className="topbar__icon" to="/account" aria-label={t(language, 'account')}>
              👤
            </Link>
          </>
        }
      />
      <OfflineBanner />

      <nav className="home-tiles">
        <BigButton icon="➕" label={t(language, 'sell')} color="green" size="huge" onClick={() => navigate('/sell')} />
        <BigButton icon="🔍" label={t(language, 'buy')} color="blue" size="huge" onClick={() => navigate('/browse')} />
        <BigButton icon="👥" label={t(language, 'groups')} color="teal" size="huge" onClick={() => navigate('/groups')} />
      </nav>

      <section className="section">
        <header className="section__header">
          <strong>{t(language, 'buy')}</strong>
          <Link to="/browse" className="section__link">
            {t(language, 'all_categories')} →
          </Link>
        </header>

        {loading && !ads.length ? <Spinner /> : null}
        {!loading && !ads.length ? (
          <EmptyState
            icon="🛒"
            title={t(language, 'empty_ads')}
            hint={online ? undefined : t(language, 'offline_banner')}
            action={<BigButton icon="➕" label={t(language, 'sell')} color="green" onClick={() => navigate('/sell')} />}
          />
        ) : null}

        <div className="ad-grid">
          {ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} />
          ))}
        </div>
      </section>

      <footer className="home-footer">
        <p>🛡️ {t(language, 'safety')}</p>
        <nav className="home-footer__links">
          <Link to="/messages">{t(language, 'messages')}</Link>
          <Link to="/calls">{t(language, 'calls')}</Link>
          <Link to="/my-ads">{t(language, 'my_ads')}</Link>
          <Link to="/notifications">{t(language, 'notifications')}</Link>
          <Link to="/blocked">{t(language, 'blocked_list')}</Link>
          {meta.features?.stt ? <span>🎙️ {t(language, 'voice_search')}</span> : null}
        </nav>
      </footer>
    </div>
  );
}
