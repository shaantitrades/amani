import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { formatPhone } from '../lib/format.js';
import { BigButton, EmptyState, Spinner, TopBar } from '../components/ui.jsx';

/** Utilisateurs bloques (🚫) avec possibilite de debloquer (retour vocal). */
export default function Blocked() {
  const navigate = useNavigate();
  const { language, notify, showToast } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/me/blocked');
      setItems(data.items || []);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unblock = async (userId) => {
    try {
      const result = await api.del(`/blocks/${userId}`);
      showToast(t(language, 'unblock'), { kind: 'success', voiceKey: result.voiceKey });
      setItems((rows) => rows.filter((row) => row.id !== userId));
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  return (
    <div className="screen">
      <TopBar title={t(language, 'blocked_list')} onBack={() => navigate('/account')} />
      {loading ? <Spinner /> : null}
      {!loading && !items.length ? <EmptyState icon="🚫" title={t(language, 'no_blocked')} /> : null}
      <div className="member-list">
        {items.map((person) => (
          <div key={person.id} className="member-row">
            <span aria-hidden="true">👤</span>
            <span className="member-row__name">{person.name || formatPhone(person.phone)}</span>
            <button type="button" className="member-row__ban" onClick={() => unblock(person.id)}>
              ✅ {t(language, 'unblock')}
            </button>
          </div>
        ))}
      </div>
      <BigButton icon="⬅️" label={t(language, 'account')} color="dark" onClick={() => navigate('/account')} />
    </div>
  );
}
