import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { cacheGet, cacheSet } from '../lib/idb.js';
import { countUnread, notificationsSeenAt } from '../lib/alerts.js';
import { TABS, activeTab, tabBarVisible } from '../lib/nav.js';

const BADGES_KEY = 'badges:v1';

/**
 * Barre d'onglets collee en bas de l'ecran, facon WhatsApp :
 * Accueil / Discussions / Appels / Mes annonces / Notifications.
 *
 * - elle s'efface sur les ecrans plein ecran (publication, conversation,
 *   detail d'annonce) qui ont leur propre barre d'action ;
 * - les compteurs viennent d'un appel unique `/me` et d'un appel
 *   `/me/notifications`, relances a la navigation, au retour du reseau et au
 *   retour sur l'application : aucun sondage en arriere-plan (2G).
 */
export function TabBar() {
  const { language, authenticated, online } = useApp();
  const { pathname } = useLocation();
  const [badges, setBadges] = useState({ messages: 0, notifications: 0 });

  const visible = authenticated && tabBarVisible(pathname);
  const current = activeTab(pathname);

  const refreshBadges = useCallback(async () => {
    if (!authenticated) return;
    const seenAt = await notificationsSeenAt();
    try {
      const [me, alerts] = await Promise.all([api.get('/me'), api.get('/me/notifications?limit=30')]);
      const next = {
        messages: me?.stats?.unreadMessages || 0,
        notifications: countUnread(alerts?.items || [], seenAt),
      };
      setBadges(next);
      await cacheSet(BADGES_KEY, next);
    } catch {
      // Hors ligne : on garde le dernier compteur connu, sans bloquer l'ecran.
      const cached = await cacheGet(BADGES_KEY);
      if (cached) setBadges(cached);
    }
  }, [authenticated]);

  useEffect(() => {
    refreshBadges();
  }, [refreshBadges, pathname, online]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    // Reserve la place de la barre sous le contenu (classe posee sur <body>).
    document.body.classList.toggle('has-tabbar', visible);
    return () => document.body.classList.remove('has-tabbar');
  }, [visible]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshBadges();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshBadges]);

  if (!visible) return null;

  return (
    <nav className="tabbar" aria-label={t(language, 'navigation')}>
      {TABS.map((tab) => {
        const count = tab.badge ? badges[tab.badge] || 0 : 0;
        const active = current === tab.key;
        return (
          <Link
            key={tab.key}
            to={tab.path}
            className={`tabbar__item ${active ? 'tabbar__item--active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="tabbar__icon" aria-hidden="true">{tab.icon}</span>
            <span className="tabbar__label">{t(language, tab.labelKey)}</span>
            {count > 0 ? <span className="tabbar__badge">{count > 99 ? '99+' : count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export default TabBar;
