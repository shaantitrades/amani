import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { categoryLabel, districtLabel, t } from '../i18n/index.js';
import { formatPrice, relativeTime } from '../lib/format.js';
import { mediaUrl } from '../lib/api.js';
import { AudioPlayButton } from './media.jsx';

/**
 * Carte d'annonce (grille type Pinterest) : photo + prix en gros,
 * icone de categorie et de localisation, lecture du vocal en un geste.
 */
export function AdCard({ ad, compact = false }) {
  const { language } = useApp();
  const photo = ad.photos?.[0];
  const image = photo ? mediaUrl(photo.thumb_key || photo.storage_key) : null;
  const isSold = ad.status === 'sold' || ad.status === 'archived';
  // Beaucoup d'annonces n'ont ni quartier ni ville (vendeurs hors referentiel) :
  // on masque alors l'epingle plutot que d'afficher un 📍 vide.
  const location = districtLabel({ name: ad.district_name, name_ar: ad.district_name_ar }, language) || ad.city || '';

  return (
    <article className={`ad-card ${isSold ? 'ad-card--sold' : ''}`}>
      <Link to={`/ad/${ad.id}`} className="ad-card__link">
        <div className="ad-card__media">
          {image ? (
            <img src={image} alt={ad.title || categoryLabel({ code: ad.category_code, label_fr: ad.category_label_fr }, language)} loading="lazy" />
          ) : (
            <div className="ad-card__placeholder" aria-hidden="true">
              {ad.category_icon || '📦'}
            </div>
          )}
          <span className="ad-card__kind" data-kind={ad.kind}>
            {ad.kind === 'want' ? t(language, 'i_search') : t(language, 'i_sell')}
          </span>
          {isSold ? <span className="ad-card__sold">{t(language, 'sold')}</span> : null}
        </div>
        <div className="ad-card__body">
          <strong className="ad-card__price">{formatPrice(ad.price_amount, ad.currency) || '—'}</strong>
          <span className="ad-card__title">{ad.title || ad.category_label_fr}</span>
          <span className="ad-card__meta">
            <span aria-hidden="true">{ad.category_icon}</span>
            <span>{categoryLabel({ label_fr: ad.category_label_fr, label_ar: ad.category_label_ar, label_ff: ad.category_label_ff, label_sar: ad.category_label_sar, code: ad.category_code }, language)}</span>
          </span>
          <span className="ad-card__meta ad-card__meta--district">
            {location ? (
              <>
                <span aria-hidden="true">📍</span>
                <span>{location}</span>
              </>
            ) : null}
            {!compact && ad.published_at ? <span className="ad-card__time">{relativeTime(ad.published_at)}</span> : null}
          </span>
        </div>
      </Link>
      {ad.description_audio_key ? (
        <div className="ad-card__audio">
          <AudioPlayButton storageKey={ad.description_audio_key} seconds={ad.description_audio_seconds} size="small" />
        </div>
      ) : null}
    </article>
  );
}

export default AdCard;
