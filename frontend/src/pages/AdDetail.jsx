import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { categoryLabel, districtLabel, t } from '../i18n/index.js';
import { api, mediaUrl } from '../lib/api.js';
import { formatPhone, formatPrice, relativeTime } from '../lib/format.js';
import { BigButton, IconButton, Sheet, Spinner, TopBar } from '../components/ui.jsx';
import { AudioPlayButton } from '../components/media.jsx';
import { ContactBar } from '../components/ContactBar.jsx';
import { ReportSheet } from '../components/ReportSheet.jsx';
import { ConfirmSheet } from '../components/ConfirmSheet.jsx';
import { adShareText, adShareUrl, canNativeShare, copyToClipboard, shareNatively, whatsappShareLink } from '../lib/share.js';

const MapView = lazy(() => import('../components/MapView.jsx'));

/**
 * Vue detaillee : photos, prix, localisation, ecoute du message vocal.
 * Le contact se fait dans l'application (appel direct, discussion 💬, message
 * vocal) : aucun renvoi vers WhatsApp. Le signalement (⚠️) reste accessible et
 * propose de bloquer l'utilisateur dans la meme action — le blocage n'a donc
 * plus de bouton dedie sur la fiche.
 * Le proprietaire y retrouve les deux gestes de gestion de son annonce :
 * modifier (✏️, assistant pre-rempli) et supprimer (🗑️, toujours confirme).
 */
export default function AdDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { language, showToast, notify, announce } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(null); // report | map | share | delete_ad
  const [deleting, setDeleting] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await api.get(`/ads/${id}`);
        if (!cancelled) {
          setData(result);
          announce('safety_warning');
        }
      } catch (err) {
        if (!cancelled) {
          notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
          if (err.status === 403 || err.status === 404) navigate('/browse', { replace: true });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, language, navigate, notify, announce]);

  /** Partage du lien (WhatsApp, menu du telephone, copie) : l'annonce n'est
   *  visible qu'apres inscription, et la discussion avec le vendeur se tient
   *  dans l'application : celui qui recoit le lien cree donc un compte. */
  const share = () => {
    if (!data) return;
    const url = adShareUrl(data.ad.id);
    const text = adShareText(
      {
        title: data.ad.title,
        price_label: formatPrice(data.ad.price_amount, data.ad.currency),
        district_name: data.ad.district_name,
      },
      url,
    );
    return { url, text };
  };

  const shareWhatsapp = () => {
    const payload = share();
    if (!payload) return;
    window.open(whatsappShareLink(payload.text), '_blank', 'noopener');
    setSheet(null);
  };

  const shareNative = async () => {
    const payload = share();
    if (!payload) return;
    await shareNatively({ title: data.ad.title || 'Bodogui', text: payload.text, url: payload.url });
    setSheet(null);
  };

  const copyLink = async () => {
    const payload = share();
    if (!payload) return;
    const ok = await copyToClipboard(payload.url);
    showToast(ok ? t(language, 'share_copied') : payload.url, { kind: 'success' });
    setSheet(null);
  };

  const markSold = async () => {
    try {
      const result = await api.patch(`/ads/${data.ad.id}/status`, { status: 'sold' });
      showToast(t(language, 'sold'), { kind: 'success', voiceKey: result.voiceKey });
      setData({ ...data, ad: result.ad });
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  /**
   * Suppression par le proprietaire (🗑️) : confirmee puis definitive.
   * On redirige vers "Mes annonces" : la fiche n'existe plus, rester dessus
   * afficherait une erreur.
   */
  const removeAd = async () => {
    setDeleting(true);
    try {
      await api.patch(`/ads/${data.ad.id}/status`, { status: 'deleted' });
      setSheet(null);
      announce('ad_deleted');
      navigate('/my-ads', { replace: true });
    } catch (err) {
      setSheet(null);
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <Spinner />;
  if (!data) return null;

  const { ad, permissions } = data;
  const photos = ad.photos || [];
  const category = {
    label_fr: ad.category_label_fr,
    label_ar: ad.category_label_ar,
    label_ff: ad.category_label_ff,
    label_sar: ad.category_label_sar,
    code: ad.category_code,
  };
  // Localisation facultative : un vendeur hors des quartiers du referentiel
  // publie sans quartier, on n'affiche alors ni epingle ni tiret.
  const location = districtLabel({ name: ad.district_name, name_ar: ad.district_name_ar }, language) || ad.city || '';

  return (
    <div className="screen screen--detail">
      <TopBar
        title={formatPrice(ad.price_amount, ad.currency) || ad.category_label_fr}
        subtitle={location}
        onBack={() => navigate(-1)}
        right={
          permissions.can_report ? (
            <IconButton icon="⚠️" label={t(language, 'report')} onClick={() => setSheet('report')} color="onDark" />
          ) : null
        }
      />

      <div className="gallery">
        {photos.length ? (
          <div
            className="gallery__scroller"
            onScroll={(event) => {
              const width = event.currentTarget.clientWidth || 1;
              setPhotoIndex(Math.round(event.currentTarget.scrollLeft / width));
            }}
          >
            {photos.map((photo) => (
              <img
                key={photo.storage_key}
                className="gallery__image"
                src={mediaUrl(photo.storage_key)}
                alt=""
                loading="lazy"
              />
            ))}
          </div>
        ) : (
          <div className="gallery__placeholder" aria-hidden="true">{ad.category_icon}</div>
        )}
        {photos.length > 1 ? (
          <span className="gallery__counter">
            {photoIndex + 1}/{photos.length}
          </span>
        ) : null}
      </div>

      <section className="detail">
        <div className="detail__price-row">
          <strong className="detail__price">{formatPrice(ad.price_amount, ad.currency) || '—'}</strong>
          {ad.kind === 'want' ? <span className="badge badge--blue">{t(language, 'i_search')}</span> : null}
          {ad.price_negotiable && ad.price_amount ? <span className="badge">{t(language, 'price_negotiable')}</span> : null}
        </div>

        <h1 className="detail__title">{ad.title || categoryLabel(category, language)}</h1>

        <div className="detail__meta">
          <span>{ad.category_icon} {categoryLabel(category, language)}</span>
          {location ? <span>📍 {location}</span> : null}
          <span>👁️ {ad.views_count}</span>
          <span>🕒 {relativeTime(ad.published_at || ad.created_at)}</span>
        </div>

        {ad.description_audio_key ? (
          <div className="detail__audio">
            <AudioPlayButton
              storageKey={ad.description_audio_key}
              seconds={ad.description_audio_seconds}
              label={t(language, 'listen_description')}
              color="green"
              size="large"
            />
          </div>
        ) : null}

        {ad.description_text ? <p className="detail__text">{ad.description_text}</p> : null}
        {ad.description_transcript ? (
          <p className="detail__text detail__text--muted">« {ad.description_transcript} »</p>
        ) : null}

        <div className="detail__safety">🛡️ {t(language, 'safety')}</div>

        <div className="detail__owner">
          <div>
            <strong>
              {ad.owner_name || formatPhone(ad.owner_phone)}
              {ad.owner_verified ? <span className="badge badge--green"> ✔</span> : null}
            </strong>
            <span className="detail__owner-phone">{formatPhone(ad.owner_phone)}</span>
            {ad.owner_ratings_count ? (
              <span className="detail__rating">⭐ {ad.owner_rating_avg || '-'} ({ad.owner_ratings_count})</span>
            ) : null}
          </div>
          <div className="detail__owner-actions">
            <BigButton icon="📤" label={t(language, 'share')} color="teal" onClick={() => setSheet('share')} />
            {ad.lat || ad.lng ? (
              <BigButton icon="🗺️" label={t(language, 'on_map')} color="blue" onClick={() => setSheet('map')} />
            ) : null}
            {permissions.is_owner ? (
              <BigButton
                icon="✏️"
                label={t(language, 'edit_ad')}
                color="blue"
                onClick={() => navigate(`/sell?edit=${ad.id}`)}
              />
            ) : null}
            {permissions.is_owner && ad.status === 'published' ? (
              <BigButton icon="🤝" label={t(language, 'mark_sold')} color="teal" onClick={markSold} />
            ) : null}
            {permissions.is_owner ? (
              <BigButton
                icon="🗑️"
                label={t(language, 'delete')}
                color="danger"
                onClick={() => setSheet('delete_ad')}
              />
            ) : null}
          </div>
        </div>
      </section>

      <ContactBar ad={ad} />

      <ReportSheet
        open={sheet === 'report'}
        onClose={() => setSheet(null)}
        targetType="ad"
        targetId={ad.id}
      />

      <Sheet open={sheet === 'map'} title={t(language, 'on_map')} onClose={() => setSheet(null)}>
        <Suspense fallback={<Spinner />}>
          <MapView lat={ad.lat} lng={ad.lng} label={ad.title || ''} district={ad.district_name} />
        </Suspense>
      </Sheet>

      {/* Confirmation avant suppression : l'action est definitive */}
      <ConfirmSheet
        open={sheet === 'delete_ad'}
        title={t(language, 'confirm')}
        message={t(language, 'confirm_delete_ad')}
        confirmIcon="🗑️"
        confirmLabel={t(language, 'delete')}
        busy={deleting}
        onClose={() => setSheet(null)}
        onConfirm={removeAd}
      />

      {/* Partage de l'annonce : WhatsApp, menu du telephone, copie du lien */}
      <Sheet open={sheet === 'share'} title={t(language, 'share')} onClose={() => setSheet(null)}>
        <p className="confirm__message">
          📤 {adShareText({ title: ad.title, price_label: formatPrice(ad.price_amount, ad.currency) }, '')}
        </p>
        <BigButton icon="💬" label={t(language, 'share_whatsapp')} color="teal" size="large" onClick={shareWhatsapp} />
        {canNativeShare() ? (
          <BigButton icon="📱" label={t(language, 'share')} color="blue" onClick={shareNative} />
        ) : null}
        <BigButton icon="🔗" label={t(language, 'share_copy')} color="grey" onClick={copyLink} />
      </Sheet>
    </div>
  );
}
