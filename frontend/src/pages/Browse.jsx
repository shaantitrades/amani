import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { categoryLabel, districtLabel, t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { cacheGet, cacheSet } from '../lib/idb.js';
import { formatPrice } from '../lib/format.js';
import { BigButton, EmptyState, Sheet, Spinner, TopBar } from '../components/ui.jsx';
import { AdCard } from '../components/AdCard.jsx';
import { NumericKeypad } from '../components/forms.jsx';
import { VoiceRecorder } from '../components/media.jsx';

/**
 * Acheter : grille de photos + filtres par icones (categorie, quartier, prix)
 * et recherche vocale quand le module Speech-to-Text est active.
 */
export default function Browse() {
  const { language, meta, showToast, notify, announce } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(null); // category | district | price | voice
  const [priceDraft, setPriceDraft] = useState({ min: '', max: '', field: 'max' });

  const categoryId = params.get('category_id') || '';
  const districtId = params.get('district_id') || '';
  const minPrice = params.get('min_price') || '';
  const maxPrice = params.get('max_price') || '';
  const kind = params.get('kind') || '';
  const q = params.get('q') || '';

  const buildSearch = useCallback(() => {
    const search = new URLSearchParams();
    if (categoryId) search.set('category_id', categoryId);
    if (districtId) search.set('district_id', districtId);
    if (minPrice) search.set('min_price', minPrice);
    if (maxPrice) search.set('max_price', maxPrice);
    if (kind) search.set('kind', kind);
    if (q) search.set('q', q);
    search.set('limit', '30');
    return search;
  }, [categoryId, districtId, maxPrice, minPrice, kind, q]);

  const load = useCallback(async () => {
    const search = buildSearch();
    setLoading(true);
    try {
      const data = await api.get(`/search?${search.toString()}`, { auth: false });
      setAds(data.items || []);
      await cacheSet(`search:${search.toString()}`, data);
    } catch {
      const cached = await cacheGet(`search:${search.toString()}`);
      if (cached) setAds(cached.items || []);
      else showToast(t(language, 'error_offline'), { kind: 'error', voiceKey: 'error_offline' });
    } finally {
      setLoading(false);
    }
  }, [buildSearch, language, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const updateParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const sendVoiceSearch = async (recorded) => {
    try {
      const form = new FormData();
      form.append('audio', recorded.blob, 'search.webm');
      form.append('seconds', String(recorded.seconds));
      const data = await api.upload('/search/voice', form);
      setSheet(null);
      if (data.transcript) {
        updateParam('q', data.transcript);
        showToast(`« ${data.transcript} »`, { kind: 'info' });
      } else {
        notify(t(language, 'voice_search_hint'), { kind: 'info', voiceKey: data.voiceKey });
        setSheet('category');
      }
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  const activeFilters = [categoryId, districtId, minPrice || maxPrice, kind].filter(Boolean).length;
  const selectedCategory = meta.categories.find((c) => c.id === categoryId);
  const selectedDistrict = meta.districts.find((d) => d.id === districtId);

  return (
    <div className="screen">
      <TopBar
        title={t(language, 'buy')}
        onBack={() => navigate('/home')}
        right={
          <button
            type="button"
            className="topbar__toggle"
            onClick={() => setSheet('voice')}
            aria-label={t(language, 'voice_search')}
          >
            🎙️
          </button>
        }
      />

      <div className="search-bar">
        <input
          className="input"
          type="search"
          placeholder={t(language, 'search')}
          defaultValue={q}
          onKeyDown={(event) => {
            if (event.key === 'Enter') updateParam('q', event.currentTarget.value);
          }}
        />
        <span className="search-bar__count">{activeFilters ? `⚙️ ${activeFilters}` : '⚙️'}</span>
      </div>

      <div className="chips">
        <button
          type="button"
          className={`chip ${kind === 'sell' ? 'chip--active' : ''}`}
          onClick={() => updateParam('kind', kind === 'sell' ? '' : 'sell')}
        >
          ✅ {t(language, 'i_sell')}
        </button>
        <button
          type="button"
          className={`chip ${kind === 'want' ? 'chip--active' : ''}`}
          onClick={() => updateParam('kind', kind === 'want' ? '' : 'want')}
        >
          🔎 {t(language, 'i_search')}
        </button>
        <button type="button" className="chip" onClick={() => setSheet('category')}>
          {selectedCategory?.icon || '🧺'}{' '}
          {selectedCategory ? categoryLabel(selectedCategory, language) : t(language, 'filter_category')}
        </button>
        <button type="button" className="chip" onClick={() => setSheet('district')}>
          📍 {selectedDistrict ? districtLabel(selectedDistrict, language) : t(language, 'filter_district')}
        </button>
        <button type="button" className="chip" onClick={() => setSheet('price')}>
          💰{' '}
          {minPrice || maxPrice
            ? `${formatPrice(minPrice || 0)} - ${formatPrice(maxPrice || 0)}`
            : t(language, 'filter_price')}
        </button>
      </div>

      {loading && !ads.length ? <Spinner /> : null}
      {!loading && !ads.length ? (
        <EmptyState
          icon="🔍"
          title={t(language, 'empty_ads')}
          action={
            <BigButton icon="🎙️" label={t(language, 'voice_search')} color="blue" onClick={() => setSheet('voice')} />
          }
        />
      ) : null}

      <div className="ad-grid">
        {ads.map((ad) => (
          <AdCard key={ad.id} ad={ad} />
        ))}
      </div>

      <Sheet open={sheet === 'category'} title={t(language, 'filter_category')} onClose={() => setSheet(null)}>
        <div className="category-grid" style={{ '--columns': 3 }}>
          <button
            type="button"
            className={`category-tile ${!categoryId ? 'category-tile--active' : ''}`}
            onClick={() => {
              updateParam('category_id', '');
              setSheet(null);
            }}
          >
            <span className="category-tile__icon">🧺</span>
            <span className="category-tile__label">{t(language, 'all_categories')}</span>
          </button>
          {meta.categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`category-tile ${categoryId === category.id ? 'category-tile--active' : ''}`}
              onClick={() => {
                updateParam('category_id', category.id);
                setSheet(null);
                announce('category_selected');
              }}
            >
              <span className="category-tile__icon">{category.icon}</span>
              <span className="category-tile__label">{categoryLabel(category, language)}</span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === 'district'} title={t(language, 'filter_district')} onClose={() => setSheet(null)}>
        <div className="district-grid">
          <button
            type="button"
            className={`district-tile ${!districtId ? 'district-tile--active' : ''}`}
            onClick={() => {
              updateParam('district_id', '');
              setSheet(null);
            }}
          >
            🗺️ {t(language, 'all_districts')}
          </button>
          {meta.districts.map((district) => (
            <button
              key={district.id}
              type="button"
              className={`district-tile ${districtId === district.id ? 'district-tile--active' : ''}`}
              onClick={() => {
                updateParam('district_id', district.id);
                setSheet(null);
                announce('location_saved');
              }}
            >
              🏘️ {districtLabel(district, language)}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === 'price'} title={t(language, 'filter_price')} onClose={() => setSheet(null)}>
        <div className="chips">
          <button
            type="button"
            className={`chip ${priceDraft.field === 'min' ? 'chip--active' : ''}`}
            onClick={() => setPriceDraft({ ...priceDraft, field: 'min' })}
          >
            {t(language, 'min_price')}
          </button>
          <button
            type="button"
            className={`chip ${priceDraft.field === 'max' ? 'chip--active' : ''}`}
            onClick={() => setPriceDraft({ ...priceDraft, field: 'max' })}
          >
            {t(language, 'max_price')}
          </button>
        </div>
        <NumericKeypad
          value={priceDraft[priceDraft.field]}
          onChange={(value) => setPriceDraft({ ...priceDraft, [priceDraft.field]: value })}
          onConfirm={() => {
            updateParam('min_price', priceDraft.min);
            updateParam('max_price', priceDraft.max);
            setSheet(null);
          }}
        />
      </Sheet>

      <Sheet open={sheet === 'voice'} title={t(language, 'voice_search')} onClose={() => setSheet(null)}>
        <VoiceRecorder
          onRecorded={sendVoiceSearch}
          maxSeconds={15}
          hint={meta.features?.stt ? undefined : t(language, 'voice_search_hint')}
        />
      </Sheet>
    </div>
  );
}
