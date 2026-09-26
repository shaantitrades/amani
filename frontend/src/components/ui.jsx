import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { useSync } from '../hooks/useSync.js';

/**
 * Briques d'interface communes.
 * Regle : tout element tactile fait au moins 60x60 px (cahier des charges).
 */

/** Gros bouton d'action (icone au-dessus du libelle, couleurs WhatsApp). */
export function BigButton({
  icon,
  label,
  color = 'green',
  onClick,
  disabled,
  type = 'button',
  size = 'normal',
  badge,
  ariaLabel,
  children,
}) {
  return (
    <button
      type={type}
      className={`big-button big-button--${color} big-button--${size}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || label || icon}
    >
      {icon ? <span className="big-button__icon" aria-hidden="true">{icon}</span> : null}
      {label ? <span className="big-button__label">{label}</span> : null}
      {badge ? <span className="big-button__badge">{badge}</span> : null}
      {children}
    </button>
  );
}

/** Bouton icone rond (retour, langue, voix...). */
export function IconButton({ icon, onClick, label, color = 'ghost', disabled, badge }) {
  return (
    <button
      type="button"
      className={`icon-button icon-button--${color}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{icon}</span>
      {badge ? <span className="icon-button__badge">{badge}</span> : null}
    </button>
  );
}

/** Barre superieure vert fonce, style WhatsApp. */
export function TopBar({ title, subtitle, onBack, right, children }) {
  return (
    <header className="topbar">
      {onBack ? <IconButton icon="←" label="Retour" onClick={onBack} color="onDark" /> : null}
      <div className="topbar__titles">
        <strong className="topbar__title">{title}</strong>
        {subtitle ? <span className="topbar__subtitle">{subtitle}</span> : null}
      </div>
      <div className="topbar__right">{right}</div>
      {children}
    </header>
  );
}

/** Feuille modale du bas (choix, filtres, confirmation). */
export function Sheet({ open, title, onClose, children, footer }) {
  const { language } = useApp();
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet__grabber" />
        <div className="sheet__header">
          <strong>{title}</strong>
          <IconButton icon="✕" label={t(language, 'close')} onClick={onClose} />
        </div>
        <div className="sheet__body">{children}</div>
        {footer ? <div className="sheet__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Spinner({ label }) {
  const { language } = useApp();
  return (
    <div className="spinner" role="status">
      <div className="spinner__circle" />
      <span>{label || t(language, 'loading')}</span>
    </div>
  );
}

export function EmptyState({ icon = '📭', title, hint, action }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">{icon}</div>
      <strong>{title}</strong>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  );
}

/** Bandeau hors ligne + nombre d'annonces en attente + bouton de synchro. */
export function OfflineBanner() {
  const { online, pending, language } = useApp();
  const { sync } = useSync();
  if (online && !pending) return null;

  return (
    <div className={`offline-banner ${online ? 'offline-banner--pending' : ''}`}>
      <span aria-hidden="true">{online ? '⏳' : '📴'}</span>
      <span className="offline-banner__text">
        {online ? `${pending} ${t(language, 'pending_sync')}` : t(language, 'offline_banner')}
      </span>
      {online && pending ? (
        <button type="button" className="offline-banner__action" onClick={() => sync()}>
          {t(language, 'sync_now')}
        </button>
      ) : null}
    </div>
  );
}

/** Message flottant (confirmation visuelle, doublee d'un message vocal). */
export function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div className={`toast toast--${toast.kind}`} role="status">
      {toast.message}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      {label ? <span className="field__label">{label}</span> : null}
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export default { BigButton, IconButton, TopBar, Sheet, Spinner, EmptyState, OfflineBanner, Toast, Field };
