import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api, mediaUrl } from '../lib/api.js';
import { formatPrice, relativeTime } from '../lib/format.js';
import { BigButton, EmptyState, OfflineBanner, Spinner, TopBar } from '../components/ui.jsx';
import { ConfirmSheet } from '../components/ConfirmSheet.jsx';
import { useSync } from '../hooks/useSync.js';

/**
 * Mes annonces : publiees, vendues, et brouillons en attente de reseau.
 * Chaque ligne permet de corriger (✏️, meme assistant que la publication) ou
 * de supprimer (🗑️) l'annonce. La suppression est toujours confirmee : un
 * appui mal place ne doit pas faire disparaitre une annonce.
 */
export default function MyAds() {
  const navigate = useNavigate();
  const { language, notify, drafts } = useApp();
  const { sync, refresh } = useSync();
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState(null); // annonce en attente de confirmation
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/me/ads?limit=50');
      setAds(data.items || []);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeStatus = async (adId, status) => {
    try {
      const result = await api.patch(`/ads/${adId}/status`, { status });
      setAds((rows) =>
        rows
          .filter((row) => (status === 'deleted' ? row.id !== adId : true))
          .map((row) => (row.id === adId ? { ...row, status } : row)),
      );
      // Le message suit le geste : "VENDU" pour une vente, sinon l'action faite.
      const label = status === 'sold' ? t(language, 'sold') : t(language, 'delete');
      await notify(label, { kind: 'success', voiceKey: result.voiceKey });
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  const confirmDelete = async () => {
    const adId = toDelete?.id;
    setDeleting(true);
    try {
      if (adId) await changeStatus(adId, 'deleted');
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  return (
    <div className="screen">
      <TopBar title={t(language, 'my_ads')} onBack={() => navigate('/account')} />
      <OfflineBanner />

      {drafts.length ? (
        <section className="account-section">
          <h3>⏳ {t(language, 'pending_sync')}</h3>
          {drafts.map((draft) => (
            <div key={draft.id} className="draft-row">
              {draft.photoUrl ? <img src={draft.photoUrl} alt="" /> : <span aria-hidden="true">📷</span>}
              <div>
                <strong>{draft.title}</strong>
                <small>
                  {draft.price ? formatPrice(draft.price) : ''} · {draft.status === 'error' ? draft.error : relativeTime(draft.createdAt)}
                </small>
              </div>
            </div>
          ))}
          <BigButton icon="🔄" label={t(language, 'sync_now')} color="blue" onClick={() => sync()} />
        </section>
      ) : null}

      {loading ? <Spinner /> : null}
      {!loading && !ads.length ? (
        <EmptyState
          icon="🏷️"
          title={t(language, 'empty_ads')}
          action={<BigButton icon="➕" label={t(language, 'sell')} color="green" onClick={() => navigate('/sell')} />}
        />
      ) : null}

      <div className="my-ad-list">
        {ads.map((ad) => (
          <div key={ad.id} className="my-ad-row">
            <Link to={`/ad/${ad.id}`} className="my-ad-row__link">
              {ad.photos?.[0] ? (
                <img src={mediaUrl(ad.photos[0].thumb_key || ad.photos[0].storage_key)} alt="" />
              ) : (
                <span className="my-ad-row__placeholder" aria-hidden="true">{ad.category_icon}</span>
              )}
              <div className="my-ad-row__body">
                <strong>{ad.title || ad.category_label_fr}</strong>
                <small>
                  {formatPrice(ad.price_amount, ad.currency)} · {ad.status}
                </small>
                <small>👁️ {ad.views_count} · {relativeTime(ad.created_at)}</small>
              </div>
            </Link>
            <div className="my-ad-row__actions">
              <BigButton
                icon="✏️"
                label=""
                color="blue"
                size="small"
                ariaLabel={t(language, 'edit_ad')}
                onClick={() => navigate(`/sell?edit=${ad.id}`)}
              />
              {ad.status === 'published' ? (
                <BigButton icon="🤝" label="" color="teal" size="small" onClick={() => changeStatus(ad.id, 'sold')} />
              ) : null}
              <BigButton
                icon="🗑️"
                label=""
                color="danger"
                size="small"
                ariaLabel={t(language, 'delete')}
                onClick={() => setToDelete(ad)}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Suppression depuis la liste : confirmee, comme depuis la fiche annonce */}
      <ConfirmSheet
        open={Boolean(toDelete)}
        title={t(language, 'confirm')}
        message={t(language, 'confirm_delete_ad')}
        confirmIcon="🗑️"
        confirmLabel={t(language, 'delete')}
        busy={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
