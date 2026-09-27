import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api, mediaUrl } from '../lib/api.js';
import { compressImage } from '../lib/image.js';
import { formatBytes, formatPhone, relativeTime } from '../lib/format.js';
import { imageKey, isFileMessage, isImageMessage } from '../lib/messages.js';
import { validateFileForUpload } from '../lib/messages.js';
import { BigButton, EmptyState, Sheet, Spinner, TopBar } from '../components/ui.jsx';
import { AdCard } from '../components/AdCard.jsx';
import { AudioPlayButton, VoiceRecorder } from '../components/media.jsx';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Page d'un groupe, en deux onglets :
 *  - DISCUSSION : cadre de discussion type WhatsApp (messages vocaux et textuels)
 *  - ANNONCES  : les annonces publiees par les membres
 * L'administrateur peut exclure un membre ou supprimer une publication.
 */
export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { language, notify, showToast, user } = useApp();
  const [group, setGroup] = useState(null);
  const [ads, setAds] = useState([]);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('chat'); // chat | ads
  const [sheet, setSheet] = useState(null); // members | voice
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const photoInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const isAdmin = group?.membership?.role === 'admin';
  const isMember = group?.membership?.status === 'active' || isAdmin;

  const load = async () => {
    setLoading(true);
    try {
      const detail = await api.get(`/groups/${id}`);
      const joined = detail.group?.membership?.status === 'active' || detail.group?.membership?.role === 'admin';
      setGroup(detail.group);

      const [feed, thread] = await Promise.all([
        api.get(`/groups/${id}/ads?limit=30`).catch(() => ({ items: [] })),
        joined ? api.get(`/groups/${id}/messages?limit=50`).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      ]);
      setAds(feed.items || []);
      setMessages(thread.items || []);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
      navigate('/groups', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Les messages arrivent du plus recent au plus ancien : on affiche l'inverse
  // et on reste positionne en bas de la discussion.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const join = async () => {
    try {
      const result = await api.post(`/groups/${id}/join`);
      showToast(t(language, 'join'), { kind: 'success', voiceKey: result.voiceKey });
      load();
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  const sendText = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const result = await api.post(`/groups/${id}/messages`, { kind: 'text', body });
      setMessages((prev) => [result.message, ...prev]);
      setText('');
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setSending(false);
    }
  };

  const sendVoice = async (recorded) => {
    setSheet(null);
    setSending(true);
    try {
      const form = new FormData();
      form.append('audio', recorded.blob, 'groupe.webm');
      form.append('seconds', String(recorded.seconds));
      const result = await api.upload(`/groups/${id}/messages`, form);
      setMessages((prev) => [result.message, ...prev]);
      showToast(t(language, 'send_voice'), { kind: 'success', voiceKey: 'interest_sent' });
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setSending(false);
    }
  };

  /** Photo : compressee sur le telephone (< 100 Ko) avant l'envoi. */
  const sendPhoto = async (file) => {
    if (!file) return;
    setSending(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append('photo', compressed.blob, file.name || 'photo.webp');
      const result = await api.upload(`/groups/${id}/messages`, form);
      setMessages((prev) => [result.message, ...prev]);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setSending(false);
    }
  };

  /** Document : type et poids verifies sur le telephone (retour immediat). */
  const sendFile = async (file) => {
    if (!file) return;
    const check = validateFileForUpload(file, MAX_FILE_BYTES);
    if (!check.ok) {
      const key = check.reason === 'size' ? 'error_file_too_large' : 'error_file_type';
      notify(t(language, key), { kind: 'error', voiceKey: key });
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const result = await api.upload(`/groups/${id}/messages`, form);
      setMessages((prev) => [result.message, ...prev]);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setSending(false);
    }
  };

  const openMembers = async () => {
    setSheet('members');
    try {
      const data = await api.get(`/groups/${id}/members`);
      setMembers(data.items || []);
    } catch {
      setMembers([]);
    }
  };

  const banMember = async (userId) => {
    try {
      const result = await api.post(`/groups/${id}/members/${userId}/ban`, { reason: 'Moderation groupe' });
      showToast(t(language, 'ban_member'), { kind: 'success', voiceKey: result.voiceKey });
      setMembers((rows) => rows.filter((row) => row.id !== userId));
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  const removePost = async (adId) => {
    try {
      const result = await api.del(`/groups/${id}/ads/${adId}`);
      showToast(t(language, 'delete'), { kind: 'success', voiceKey: result.voiceKey });
      setAds((rows) => rows.filter((row) => row.id !== adId));
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    }
  };

  if (loading) return <Spinner />;
  if (!group) return null;

  return (
    <div className={`screen screen--chat ${tab === 'chat' ? 'screen--chat-pane' : ''}`}>
      <TopBar
        title={group.name}
        subtitle={`${group.members_count} ${t(language, 'members')}${group.is_private ? ' · 🔒' : ''}`}
        onBack={() => navigate('/groups')}
        right={
          <button type="button" className="topbar__toggle" onClick={openMembers} aria-label={t(language, 'members')}>
            👥
          </button>
        }
      />

      <div className="group-tabs">
        <button type="button" className={`chip ${tab === 'chat' ? 'chip--active' : ''}`} onClick={() => setTab('chat')}>
          💬 {t(language, 'group_chat')}
        </button>
        <button type="button" className={`chip ${tab === 'ads' ? 'chip--active' : ''}`} onClick={() => setTab('ads')}>
          🏷️ {t(language, 'my_ads')} ({ads.length})
        </button>
      </div>

      {isMember ? (
        <BigButton
          icon="➕"
          label={t(language, 'new_post')}
          color="green"
          onClick={() => navigate(`/sell?group=${id}`)}
        />
      ) : (
        <BigButton icon="👥" label={t(language, 'join')} color="green" onClick={join} />
      )}

      {tab === 'chat' ? renderChat() : renderAds()}
    </div>
  );

  /** Cadre de discussion type WhatsApp : bulles + lecteur vocal. */
  function renderChat() {
    return (
      <>
        <div className="chat-frame">
          {!messages.length ? (
            <p className="chat-frame__empty">💬 {isMember ? t(language, 'no_messages') : t(language, 'members_only')}</p>
          ) : null}

          <div className="chat-frame__list">
            {[...messages].reverse().map((message) => {
              const mine = message.sender_id === user?.id;
              return (
                <div key={message.id} className={`bubble ${mine ? 'bubble--mine' : 'bubble--other'}`}>
                  {!mine ? (
                    <strong className="bubble__author">
                      {message.sender_name || formatPhone(message.sender_phone)}
                    </strong>
                  ) : null}
                  {message.kind === 'voice' ? (
                    <AudioPlayButton
                      storageKey={message.audio_key}
                      seconds={message.audio_seconds}
                      size="small"
                      color="blue"
                    />
                  ) : isImageMessage(message) ? (
                    /* Photo : vignette legere, ouverture en grand au toucher */
                    <a
                      className="bubble__image"
                      href={mediaUrl(message.file_key)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={mediaUrl(imageKey(message))}
                        alt={t(language, 'photos')}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.src = mediaUrl(message.file_key);
                        }}
                      />
                    </a>
                  ) : isFileMessage(message) ? (
                    /* Document : carte avec nom et poids, telechargeable */
                    <a
                      className="bubble__file"
                      href={mediaUrl(message.file_key)}
                      target="_blank"
                      rel="noreferrer"
                      download={message.file_name || ''}
                    >
                      <span className="bubble__file-icon" aria-hidden="true">📄</span>
                      <span className="bubble__file-body">
                        <strong>{message.file_name || t(language, 'document')}</strong>
                        <small>{formatBytes(message.file_bytes)}</small>
                      </span>
                    </a>
                  ) : (
                    <p className="bubble__text">{message.body}</p>
                  )}
                  {message.transcript ? <small className="bubble__transcript">{message.transcript}</small> : null}
                  <span className="bubble__time">{relativeTime(message.created_at)}</span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        {isMember ? (
          <form
            className="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendText();
            }}
          >
            {/* Piece jointe (fichier / photo / vocal), comme WhatsApp */}
            <button
              type="button"
              className="chat-composer__attach"
              onClick={() => setSheet('attach')}
              aria-label={t(language, 'attach')}
              disabled={sending}
            >
              📎
            </button>
            <input
              className="chat-composer__input"
              type="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t(language, 'write_message')}
              maxLength={1000}
            />
            {/* Photo : appareil photo du telephone */}
            <button
              type="button"
              className="chat-composer__photo"
              onClick={() => photoInputRef.current?.click()}
              aria-label={t(language, 'attach_photo')}
              disabled={sending}
            >
              📷
            </button>
            {/* Micro a droite quand le champ est vide, sinon bouton d'envoi */}
            {text.trim() ? (
              <button
                type="submit"
                className="chat-composer__send"
                aria-label={t(language, 'send')}
                disabled={sending}
              >
                {sending ? '⏳' : '➤'}
              </button>
            ) : (
              <button
                type="button"
                className="chat-composer__mic"
                onClick={() => setSheet('voice')}
                aria-label={t(language, 'attach_audio')}
                disabled={sending}
              >
                🎙️
              </button>
            )}
          </form>
        ) : (
          <p className="wizard__hint">{t(language, 'members_only')}</p>
        )}

        {/* Champs de fichiers masques, declenches par les boutons du composer */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            sendPhoto(file);
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            sendFile(file);
          }}
        />        <Sheet open={sheet === 'attach'} title={t(language, 'attach')} onClose={() => setSheet(null)}>
          <BigButton
            icon="📷"
            label={t(language, 'attach_photo')}
            color="green"
            size="large"
            onClick={() => {
              setSheet(null);
              photoInputRef.current?.click();
            }}
          />
          <BigButton
            icon="📄"
            label={t(language, 'attach_file')}
            color="blue"
            size="large"
            onClick={() => {
              setSheet(null);
              fileInputRef.current?.click();
            }}
          />
          <BigButton
            icon="🎙️"
            label={t(language, 'attach_audio')}
            color="teal"
            size="large"
            onClick={() => setSheet('voice')}
          />
        </Sheet>

        <Sheet open={sheet === 'voice'} title={t(language, 'send_voice')} onClose={() => setSheet(null)}>
          <VoiceRecorder onRecorded={sendVoice} maxSeconds={60} />
        </Sheet>

        <Sheet open={sheet === 'members'} title={t(language, 'members')} onClose={() => setSheet(null)}>
          <div className="member-list">
            {members.map((member) => (
              <div key={member.id} className="member-row">
                <span aria-hidden="true">{member.role === 'admin' ? '⭐' : '👤'}</span>
                <span className="member-row__name">{member.name || formatPhone(member.phone)}</span>
                {isAdmin && member.role !== 'admin' ? (
                  <button type="button" className="member-row__ban" onClick={() => banMember(member.id)}>
                    🚫 {t(language, 'ban_member')}
                  </button>
                ) : null}
              </div>
            ))}
            {!members.length ? <p className="muted">{t(language, 'loading')}</p> : null}
          </div>
        </Sheet>
      </>
    );
  }

  /** Onglet annonces du groupe (avec suppression pour l'administrateur). */
  function renderAds() {
    return (
      <>
        {!ads.length ? <EmptyState icon="📭" title={t(language, 'empty_ads')} /> : null}
        <div className="ad-grid">
          {ads.map((ad) => (
            <div key={ad.id} className="group-post">
              <AdCard ad={ad} />
              {isAdmin ? (
                <BigButton
                  icon="🗑️"
                  label={t(language, 'delete')}
                  color="danger"
                  size="small"
                  onClick={() => removePost(ad.id)}
                />
              ) : null}
            </div>
          ))}
        </div>
      </>
    );
  }
}

