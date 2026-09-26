import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { BigButton, EmptyState, Sheet, Spinner, TopBar } from '../components/ui.jsx';
import { VoiceRecorder } from '../components/media.jsx';

/**
 * Groupes de quartier / de metier : nom (vocal ou texte), couverture,
 * description vocale, public ou prive.
 */
export default function Groups() {
  const navigate = useNavigate();
  const { language, showToast, notify, user } = useApp();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [mine, setMine] = useState(false);
  const [form, setForm] = useState({ name: '', description_text: '', is_private: false, audio: null, cover: null });

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/groups?limit=40${mine ? '&mine=1' : ''}`);
      setGroups(data.items || []);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);

  const create = async () => {
    if (!form.name && !form.audio) {
      showToast(t(language, 'group_name'), { kind: 'error', voiceKey: 'error_generic' });
      return;
    }
    try {
      let audioKey = null;
      if (form.audio?.blob) {
        const audioForm = new FormData();
        audioForm.append('audio', form.audio.blob, 'group.webm');
        audioForm.append('seconds', String(form.audio.seconds));
        const uploaded = await api.upload('/media/audio', audioForm);
        audioKey = uploaded.key;
      }
      const result = await api.post('/groups', {
        name: form.name || user?.name || 'Groupe',
        description_text: form.description_text || null,
        description_audio_key: audioKey,
        is_private: form.is_private,
        city: user?.city || null,
        district_id: user?.district_id || null,
      });
      showToast(t(language, 'create_group'), { kind: 'success', voiceKey: result.voiceKey });
      setSheet(false);
      setForm({ name: '', description_text: '', is_private: false, audio: null, cover: null });
      navigate(`/group/${result.group.id}`);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  return (
    <div className="screen">
      <TopBar
        title={t(language, 'groups')}
        onBack={() => navigate('/home')}
        right={
          <button type="button" className="topbar__toggle" onClick={() => setSheet(true)} aria-label={t(language, 'create_group')}>
            ➕
          </button>
        }
      />

      <div className="chips">
        <button type="button" className={`chip ${!mine ? 'chip--active' : ''}`} onClick={() => setMine(false)}>
          🌍 {t(language, 'all_groups')}
        </button>
        <button type="button" className={`chip ${mine ? 'chip--active' : ''}`} onClick={() => setMine(true)}>
          👥 {t(language, 'my_groups')}
        </button>
      </div>

      {loading ? <Spinner /> : null}
      {!loading && !groups.length ? (
        <EmptyState
          icon="👥"
          title={t(language, 'all_groups')}
          action={<BigButton icon="➕" label={t(language, 'create_group')} color="green" onClick={() => setSheet(true)} />}
        />
      ) : null}

      <div className="group-list">
        {groups.map((group) => (
          <button key={group.id} type="button" className="group-row" onClick={() => navigate(`/group/${group.id}`)}>
            <span className="group-row__cover" aria-hidden="true">
              {group.is_private ? '🔒' : '👥'}
            </span>
            <span className="group-row__body">
              <strong>{group.name}</strong>
              <small>
                {group.members_count} {t(language, 'members')} · {group.ads_count} {t(language, 'results')}
                {group.my_role === 'admin' ? ' · ⭐' : ''}
              </small>
            </span>
            <span className="group-row__arrow" aria-hidden="true">›</span>
          </button>
        ))}
      </div>

      <Sheet open={sheet} title={t(language, 'create_group')} onClose={() => setSheet(false)}>
        <input
          className="input"
          type="text"
          maxLength={120}
          placeholder={t(language, 'group_name')}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <input
          className="input"
          type="text"
          maxLength={400}
          placeholder={t(language, 'description')}
          value={form.description_text}
          onChange={(event) => setForm({ ...form, description_text: event.target.value })}
        />
        <VoiceRecorder onRecorded={(audio) => setForm({ ...form, audio })} maxSeconds={30} />
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.is_private}
            onChange={(event) => setForm({ ...form, is_private: event.target.checked })}
          />
          <span>🔒 {t(language, 'settings')}</span>
        </label>
        <BigButton icon="✅" label={t(language, 'create_group')} color="green" size="large" onClick={create} />
      </Sheet>
    </div>
  );
}
