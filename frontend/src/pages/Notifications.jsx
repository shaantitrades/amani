import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { cacheGet, cacheSet } from '../lib/idb.js';
import { markNotificationsSeen } from '../lib/alerts.js';
import { relativeTime } from '../lib/format.js';
import { EmptyState, OfflineBanner, Spinner, TopBar } from '../components/ui.jsx';

const CACHE_KEY = 'notifications';
const CHANNEL_ICONS = { sms: '✉️', push: '📲', voice: '🔔' };
const STATUS_ICONS = { sent: '✅', queued: '⏳', failed: '⚠️', skipped: '⏭️' };

/**
 * Onglet Notifications : journal des alertes envoyees a l'utilisateur
 * (SMS, push, message vocal). La liste reste consultable hors ligne grace au
 * cache local ; a l'ouverture, le badge de la barre du bas repart de zero.
 */
export default function Notifications() {
  const navigate = useNavigate();
  const { language, notify } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      let list = null;
      try {
        const data = await api.get('/me/notifications?limit=30');
        list = data.items || [];
        await cacheSet(CACHE_KEY, data);
      } catch (err) {
        const cached = await cacheGet(CACHE_KEY);
        if (cached) list = cached.items || [];
        else if (alive) notify(t(language, 'error_offline'), { kind: 'error', voiceKey: err.voiceKey || 'error_offline' });
      }
      if (alive) {
        setItems(list || []);
        setLoading(false);
      }
      // Ecran consulte : les alertes affichees ne comptent plus dans le badge
      // (on retient l'heure serveur de la plus recente).
      if (list) await markNotificationsSeen(list);
    })();
    return () => {
      alive = false;
    };
  }, [language, notify]);

  return (
    <div className="screen">
      <TopBar
        title={t(language, 'notifications')}
        subtitle={t(language, 'notifications_hint')}
        onBack={() => navigate('/home')}
      />
      <OfflineBanner />

      {loading ? <Spinner /> : null}
      {!loading && !items.length ? <EmptyState icon="🔔" title={t(language, 'notifications_empty')} /> : null}

      <div className="notification-list">
        {items.map((item) => (
          <article className="notification-row" key={item.id}>
            <span className="notification-row__icon" aria-hidden="true">{CHANNEL_ICONS[item.channel] || '🔔'}</span>
            <div className="notification-row__body">
              <strong>{item.title || t(language, 'notifications')}</strong>
              {item.body ? <p>{item.body}</p> : null}
              <small>
                {relativeTime(item.created_at)}
                {STATUS_ICONS[item.status] ? ` · ${STATUS_ICONS[item.status]} ${t(language, `status_${item.status}`)}` : ''}
              </small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
