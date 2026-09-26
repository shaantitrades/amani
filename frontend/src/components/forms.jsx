import { useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { categoryLabel, t } from '../i18n/index.js';
import { formatPrice } from '../lib/format.js';
import { mediaUrl } from '../lib/api.js';
import { compressImage } from '../lib/image.js';
import { speakNumber, isSpeechEnabled } from '../lib/voice.js';
import { BigButton, IconButton } from './ui.jsx';

/**
 * Selection de photos : ouvre directement l'appareil photo, maximum 6,
 * compteur visible (3/6) et bouton "Termine" des la premiere photo.
 */
export function PhotoPicker({ photos, onChange, max = 6, onDone }) {
  const { language, showToast } = useApp();
  const inputRef = useRef(null);

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    inputRef.current.value = '';
    const room = max - photos.length;
    if (room <= 0) {
      showToast(t(language, 'error_too_many_photos'), { kind: 'error', voiceKey: 'error_too_many_photos' });
      return;
    }
    const next = [...photos];
    for (const file of files.slice(0, room)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const compressed = await compressImage(file);
        next.push({
          blob: compressed.blob,
          name: file.name || 'photo.webp',
          previewUrl: URL.createObjectURL(compressed.blob),
          size: compressed.blob.size,
        });
      } catch {
        showToast(t(language, 'error_generic'), { kind: 'error', voiceKey: 'error_generic' });
      }
    }
    onChange(next);
  };

  const remove = (index) => onChange(photos.filter((_, i) => i !== index));

  return (
    <div className="photo-picker">
      <div className="photo-picker__grid">
        {photos.map((photo, index) => (
          <div key={`${photo.name}-${index}`} className="photo-picker__item">
            <img src={photo.previewUrl || mediaUrl(photo.storage_key)} alt="" loading="lazy" />
            <IconButton icon="✕" label={t(language, 'delete')} onClick={() => remove(index)} color="danger" />
          </div>
        ))}
        {photos.length < max ? (
          <button type="button" className="photo-picker__add" onClick={() => inputRef.current?.click()}>
            <span aria-hidden="true">📷</span>
            <span>{t(language, 'add_photos')}</span>
          </button>
        ) : null}
      </div>
      <div className="photo-picker__footer">
        <span className="photo-picker__counter">
          {photos.length}/{max} {t(language, 'photos_count')}
        </span>
        {photos.length > 0 && onDone ? (
          <BigButton icon="✅" label={t(language, 'photos_done')} color="green" onClick={onDone} />
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFiles}
        style={{ display: 'none' }}
      />
    </div>
  );
}

/** Clavier numerique geant pour le prix (touches de 72 px) + lecture vocale. */
export function NumericKeypad({ value, onChange, currency = 'XAF', onConfirm, extraActions }) {
  const { language } = useApp();
  const digits = String(value ?? '');

  const press = (digit) => onChange(`${digits}${digit}`.replace(/^0+(?=\d)/, '').slice(0, 12));
  const backspace = () => onChange(digits.slice(0, -1));

  return (
    <div className="keypad">
      <div className="keypad__display">
        <strong className="keypad__value">{formatPrice(digits || 0, currency) || '0'}</strong>
        {/* Le bouton d'ecoute n'a de sens qu'avec une voix disponible
            (fichiers natifs ou synthese vocale) : masque sinon. */}
        {isSpeechEnabled() ? (
          <IconButton icon="🔊" label={t(language, 'listen')} onClick={() => speakNumber(digits || 0, currency)} />
        ) : null}
      </div>
      <div className="keypad__grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button key={digit} type="button" className="keypad__key" onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" className="keypad__key keypad__key--grey" onClick={() => onChange('')}>
          C
        </button>
        <button type="button" className="keypad__key" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="keypad__key keypad__key--grey" onClick={backspace} aria-label="Effacer">
          ⌫
        </button>
      </div>
      <div className="keypad__shortcuts">
        {[5000, 25000, 50000, 100000].map((amount) => (
          <button key={amount} type="button" onClick={() => onChange(String(amount))}>
            {formatPrice(amount, currency)}
          </button>
        ))}
      </div>
      {onConfirm ? (
        <div className="keypad__actions">
          <BigButton icon="✅" label={t(language, 'apply')} color="green" size="large" onClick={onConfirm} />
          {extraActions}
        </div>
      ) : null}
    </div>
  );
}

/** Grille d'icones des categories (choix visuel avec retour vocal). */
export function CategoryGrid({ categories, value, onChange, columns = 3 }) {
  const { language, announce } = useApp();
  return (
    <div className="category-grid" style={{ '--columns': columns }}>
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          className={`category-tile ${value === category.id ? 'category-tile--active' : ''}`}
          onClick={() => {
            onChange(category.id, category);
            announce('category_selected');
          }}
        >
          <span className="category-tile__icon" aria-hidden="true">{category.icon}</span>
          <span className="category-tile__label">{categoryLabel(category, language)}</span>
        </button>
      ))}
    </div>
  );
}

export default { PhotoPicker, NumericKeypad, CategoryGrid };
