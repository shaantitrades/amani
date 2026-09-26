import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { BigButton, Sheet } from './ui.jsx';

/**
 * Confirmation avant une action irreversible ou lourde de consequences :
 * deconnexion, suppression de compte, blocage d'un utilisateur.
 *
 * Le choix par defaut est toujours l'annulation (bouton vert = Annuler), et le
 * libelle de l'action dangereuse est explicite : un utilisateur non lecteur se
 * fie aux icones et aux couleurs.
 */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  confirmIcon = '✅',
  cancelLabel,
  onConfirm,
  onClose,
  busy = false,
}) {
  const { language } = useApp();
  return (
    <Sheet open={open} title={title || t(language, 'confirm')} onClose={onClose}>
      <p className="confirm__message">⚠️ {message}</p>
      {/* Choix sur : ANNULER est le bouton vert, l'action dangereuse est en rouge */}
      <BigButton
        icon="↩️"
        label={cancelLabel || t(language, 'cancel')}
        color="green"
        size="large"
        onClick={onClose}
      />
      <BigButton
        icon={confirmIcon}
        label={busy ? t(language, 'loading') : confirmLabel || t(language, 'ok')}
        color="danger"
        size="large"
        disabled={busy}
        onClick={onConfirm}
      />
    </Sheet>
  );
}

export default ConfirmSheet;
