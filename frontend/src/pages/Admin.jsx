import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { BigButton, EmptyState, Spinner, TopBar } from '../components/ui.jsx';

/**
 * Moderation (comptes administrateurs) : signalements, annonces suspectes,
 * bannissement d'utilisateurs, relance des notifications.
 */
export default function Admin() {
  const navigate = useNavigate();
  const { language, notify, showToast } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get('/admin/overview');
      setData(result);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
      navigate('/account', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moderateAd = async (adId, action) => {
    try {
      await api.post(`/admin/ads/${adId}/moderate`, { action });
      showToast(t(language, 'admin'), { kind: 'success', voiceKey: 'ad_deleted' });
      load();
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  const ban = async (userId, days) => {
    try {
      const result = await api.post(`/admin/users/${userId}/ban`, { reason: 'Arnaque signalee', days });
      showToast(t(language, 'admin_ban'), { kind: 'success', voiceKey: result.voiceKey });
      load();
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  const unban = async (userId) => {
    try {
      await api.post(`/admin/users/${userId}/unban`, {});
      showToast(t(language, 'admin_unban'), { kind: 'success', voiceKey: 'synced' });
      load();
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  const dispatch = async () => {
    await api.post('/admin/maintenance/dispatch-notifications', {}).catch(() => {});
    showToast(t(language, 'sync_now'), { kind: 'success', voiceKey: 'synced' });
  };

  if (loading) return <Spinner />;
  if (!data) return null;

  return (
    <div className="screen">
      <TopBar title={t(language, 'admin')} onBack={() => navigate('/account')} />

      <section className="account-section">
        <h3>📊 {data.stats.users} comptes · {data.stats.published_ads} annonces · {data.stats.open_reports} signalements</h3>
        <BigButton icon="🔄" label={t(language, 'sync_now')} color="blue" onClick={dispatch} />
      </section>

      <section className="account-section">
        <h3>⚠️ {t(language, 'admin_reports')}</h3>
        {!data.reports.length ? <EmptyState icon="✅" title="—" /> : null}
        {data.reports.map((report) => (
          <div key={report.id} className="admin-row">
            <div>
              <strong>{report.reason_code}</strong>
              <small>
                {report.target_type} · {report.reporter_name || report.reporter_phone}
              </small>
            </div>
            <div className="my-ad-row__actions">
              {report.target_type === 'ad' ? (
                <>
                  <BigButton icon="🚫" label="" color="danger" size="small" onClick={() => moderateAd(report.target_id, 'hide')} />
                  <BigButton icon="✅" label="" color="green" size="small" onClick={() => moderateAd(report.target_id, 'restore')} />
                </>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section className="account-section">
        <h3>🚫 {t(language, 'admin_ban')}</h3>
        {data.bannedUsers.map((person) => (
          <div key={person.id} className="admin-row">
            <div>
              <strong>{person.name || person.phone}</strong>
              <small>{person.ban_reason}</small>
            </div>
            <BigButton icon="✅" label={t(language, 'admin_unban')} color="green" size="small" onClick={() => unban(person.id)} />
          </div>
        ))}
        {data.suspectAds.map((ad) => (
          <div key={ad.id} className="admin-row">
            <div>
              <strong>{ad.title || ad.id.slice(0, 8)}</strong>
              <small>
                {ad.status} · {ad.reports_count} signalements · {ad.owner_phone}
              </small>
            </div>
            <div className="my-ad-row__actions">
              <BigButton
                icon="✅"
                label=""
                color="green"
                size="small"
                onClick={() => moderateAd(ad.id, 'restore')}
              />
              <BigButton
                icon="🚫"
                label={t(language, 'admin_ban')}
                color="danger"
                size="small"
                onClick={() => ban(ad.owner_id, 30)}
              />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
