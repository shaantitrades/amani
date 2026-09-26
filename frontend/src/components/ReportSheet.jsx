import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { BigButton, Sheet } from './ui.jsx';

const REASONS = [
  { code: 'scam', icon: '🚫', key: 'report_scam' },
  { code: 'illegal', icon: '⚠️', key: 'report_illegal' },
  { code: 'nudity', icon: '🙈', key: 'report_nudity' },
  { code: 'spam', icon: '📢', key: 'report_spam' },
  { code: 'other', icon: '❓', key: 'report_other' },
];

/**
 * Signalement : motifs en gros boutons + proposition automatique de bloquer
 * l'utilisateur en meme temps (exigence du cahier des charges).
 */
export function ReportSheet({ open, onClose, targetType = 'ad', targetId }) {
  const { language, showToast, notify } = useApp();
  const [reason, setReason] = useState(null);
  const [blockAlso, setBlockAlso] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async (code) => {
    setBusy(true);
    setReason(code);
    try {
      const result = await api.post('/reports', {
        target_type: targetType,
        target_id: targetId,
        reason_code: code,
        block_user: blockAlso,
      });
      showToast(t(language, 'report'), { kind: 'success', voiceKey: result.voiceKey });
      onClose();
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setBusy(false);
      setReason(null);
    }
  };

  return (
    <Sheet open={open} title={t(language, 'report_reason')} onClose={onClose}>
      <div className="reason-grid">
        {REASONS.map((item) => (
          <button
            key={item.code}
            type="button"
            className={`reason-tile ${reason === item.code ? 'reason-tile--active' : ''}`}
            onClick={() => submit(item.code)}
            disabled={busy}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{t(language, item.key)}</span>
          </button>
        ))}
      </div>
      <label className="toggle">
        <input type="checkbox" checked={blockAlso} onChange={(event) => setBlockAlso(event.target.checked)} />
        <span>🚫 {t(language, 'also_block')}</span>
      </label>
      <BigButton icon="✕" label={t(language, 'cancel')} color="grey" onClick={onClose} />
    </Sheet>
  );
}

export default ReportSheet;
