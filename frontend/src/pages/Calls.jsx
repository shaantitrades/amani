import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { cacheGet, cacheSet } from '../lib/idb.js';
import { callLabel, callLink, clearCalls, listCalls, logCall } from '../lib/calls.js';
import { formatPhone, relativeTime } from '../lib/format.js';
import { BigButton, EmptyState, OfflineBanner, Spinner, TopBar } from '../components/ui.jsx';
import { ConfirmSheet } from '../components/ConfirmSheet.jsx';

const CONTACTS_KEY = 'calls:contacts';

/**
 * Onglet Appels : les personnes avec qui vous avez deja discute, puis
 * l'historique des appels lances depuis ce telephone.
 *
 * Le numero du vendeur n'est jamais masque et l'appel passe par le composeur
 * du telephone (tel:). L'historique reste sur l'appareil (IndexedDB) : rien
 * n'est envoye au serveur.
 */
export default function Calls() {
  const navigate = useNavigate();
  const { language, showToast, notify } = useApp();
  const [contacts, setContacts] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/messages/threads');
      setContacts(data.items || []);
      await cacheSet(CONTACTS_KEY, data);
    } catch (err) {
      const cached = await cacheGet(CONTACTS_KEY);
      setContacts(cached?.items || []);
      if (!cached) {
        notify(t(language, 'error_offline'), { kind: 'error', voiceKey: err.voiceKey || 'error_offline' });
      }
    } finally {
      setLoading(false);
    }
  }, [language, notify]);

  const loadHistory = useCallback(async () => {
    setHistory(await listCalls());
  }, []);

  useEffect(() => {
    loadContacts();
    loadHistory();
  }, [loadContacts, loadHistory]);

  /** Appel direct : journalise l'appel sur l'appareil puis ouvre le composeur. */
  const startCall = async ({ name, phone }) => {
    if (!phone) return;
    await logCall({ name, phone });
    await loadHistory();
    showToast(t(language, 'call_started'), { kind: 'info', voiceKey: 'call_started' });
    window.location.href = callLink(phone);
  };

  const wipeHistory = async () => {
    setClearing(true);
    try {
      await clearCalls();
      setHistory([]);
    } finally {
      setClearing(false);
      setConfirm(false);
    }
  };

  const contactName = (contact) => contact.other_name || formatPhone(contact.other_phone) || t(language, 'contacts');

  return (
    <div className="screen">
      <TopBar title={t(language, 'calls')} onBack={() => navigate('/home')} />
      <OfflineBanner />

      <section className="account-section">
        <h3>📞 {t(language, 'new_call')}</h3>
        {loading ? <Spinner /> : null}
        {!loading && !contacts.length ? (
          <EmptyState icon="📇" title={t(language, 'no_contacts')} hint={t(language, 'safety')} />
        ) : null}
        <div className="call-list">
          {contacts.map((contact) => (
            <div className="call-row" key={contact.other_id}>
              <button type="button" className="call-row__main" onClick={() => navigate(`/messages/${contact.other_id}`)}>
                <span className="call-row__avatar" aria-hidden="true">👤</span>
                <span className="call-row__body">
                  <strong>{contactName(contact)}</strong>
                  <small>{formatPhone(contact.other_phone)}</small>
                </span>
              </button>
              <button
                type="button"
                className="call-row__action call-row__action--chat"
                aria-label={`${t(language, 'write_message_short')} ${contactName(contact)}`}
                onClick={() => navigate(`/messages/${contact.other_id}`)}
              >
                💬
              </button>
              <button
                type="button"
                className="call-row__action call-row__action--call"
                aria-label={`${t(language, 'call')} ${contactName(contact)}`}
                onClick={() => startCall({ name: contact.other_name, phone: contact.other_phone })}
              >
                📞
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="account-section">
        <h3>🕘 {t(language, 'calls_history')}</h3>
        {!history.length ? <EmptyState icon="📵" title={t(language, 'no_calls')} /> : null}
        <div className="call-list">
          {history.map((entry) => (
            <div className="call-row" key={entry.id}>
              {/* Appuyer sur la ligne relance l'appel, comme dans WhatsApp */}
              <button type="button" className="call-row__main" onClick={() => startCall(entry)}>
                <span className="call-row__avatar" aria-hidden="true">📞</span>
                <span className="call-row__body">
                  <strong>{callLabel(entry)}</strong>
                  <small>{relativeTime(entry.at)}</small>
                </span>
              </button>
              <button
                type="button"
                className="call-row__action call-row__action--call"
                aria-label={`${t(language, 'call_back')} ${callLabel(entry)}`}
                onClick={() => startCall(entry)}
              >
                📞
              </button>
            </div>
          ))}
        </div>
        {history.length ? (
          <BigButton icon="🗑️" label={t(language, 'clear_history')} color="grey" onClick={() => setConfirm(true)} />
        ) : null}
      </section>

      <ConfirmSheet
        open={confirm}
        title={t(language, 'confirm')}
        message={t(language, 'confirm_clear_history')}
        confirmIcon="🗑️"
        confirmLabel={t(language, 'clear_history')}
        busy={clearing}
        onClose={() => setConfirm(false)}
        onConfirm={wipeHistory}
      />
    </div>
  );
}
