import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { formatPhone, relativeTime } from '../lib/format.js';
import { adIntroText, localPathFromUrl, splitLinks } from '../lib/chat.js';
import { messagePreview } from '../lib/messages.js';
import { callLink, logCall } from '../lib/calls.js';
import { BigButton, EmptyState, Sheet, Spinner, TopBar } from '../components/ui.jsx';
import { AudioPlayButton, VoiceRecorder } from '../components/media.jsx';

/**
 * Discussion avec un vendeur (ou un acheteur), dans Bodogui : bulles, champ de
 * saisie et micro, comme WhatsApp — mais rien ne quitte l'application.
 * Ouverte depuis une annonce (bouton DISCUTER), la conversation rappelle
 * l'annonce concernee et pre-remplit une phrase d'accroche **avec le lien de
 * l'annonce** (cliquable dans la bulle) : un seul appui suffit a demarrer
 * l'echange et le vendeur voit exactement de quelle annonce il s'agit.
 */
export default function Messages() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { language, notify, showToast, user } = useApp();
  const [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState(null); // 'voice' | null
  const bottomRef = useRef(null);
  // Contexte transmis par le bouton DISCUTER de la fiche annonce.
  const fromAd = location.state?.fromAd ? location.state : null;

  const loadThreads = async () => {
    setLoading(true);
    try {
      const data = await api.get('/messages/threads');
      setThreads(data.items || []);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setLoading(false);
    }
  };

  const loadThread = async (otherId) => {
    setThreadLoading(true);
    try {
      const data = await api.get(`/messages/${otherId}`);
      setMessages(data.items || []);
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setThreadLoading(false);
    }
  };

  useEffect(() => {
    if (userId) loadThread(userId);
    else loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /** Phrase d'accroche pre-remplie quand la discussion part d'une annonce et
   *  que le fil est encore vide : un seul appui suffit a demarrer l'echange,
   *  lien de l'annonce compris. On n'ecrase jamais un texte deja saisi. */
  useEffect(() => {
    if (!userId || !fromAd || threadLoading || messages.length) return;
    const intro = adIntroText({ title: fromAd.adTitle, url: fromAd.adUrl }, t(language, 'ad_intro_message'));
    setText((current) => current || intro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, threadLoading, messages.length]);

  /** Le dernier message reste visible, comme dans toute messagerie. */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, threadLoading]);

  /** Appel direct depuis une conversation : journalise puis ouvre le composeur. */
  const callThread = async (thread) => {
    if (!thread?.other_phone) return;
    await logCall({ name: thread.other_name, phone: thread.other_phone });
    showToast(t(language, 'call_started'), { kind: 'info', voiceKey: 'call_started' });
    window.location.href = callLink(thread.other_phone);
  };

  /** Message texte envoye dans la conversation (le vendeur est notifie). */
  const sendText = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const result = await api.post('/messages', {
        recipient_id: userId,
        ad_id: fromAd?.adId || undefined,
        kind: 'text',
        body,
      });
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
      form.append('audio', recorded.blob, 'voice.webm');
      form.append('seconds', String(recorded.seconds));
      form.append('scope', 'message');
      const upload = await api.upload('/media/audio', form);
      const result = await api.post('/messages', {
        recipient_id: userId,
        ad_id: fromAd?.adId || undefined,
        kind: 'voice',
        audio_key: upload.key,
        audio_seconds: upload.seconds,
      });
      setMessages((prev) => [result.message, ...prev]);
      showToast(t(language, 'send_voice'), { kind: 'success', voiceKey: 'interest_sent' });
    } catch (err) {
      notify(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setSending(false);
    }
  };

  if (userId) {
    const other = threads.find((thread) => thread.other_id === userId) || null;
    // Sans historique, l'en-tete vient du contexte de l'annonce (bouton DISCUTER).
    const name = other?.other_name || fromAd?.name || null;
    const phone = other?.other_phone || fromAd?.phone || null;
    return (
      <div className="screen screen--chat screen--chat-pane">
        <TopBar
          title={name || formatPhone(phone) || t(language, 'messages')}
          subtitle={phone ? formatPhone(phone) : undefined}
          onBack={() => navigate('/messages')}
          right={
            phone ? (
              <a
                className="topbar__icon"
                href={callLink(phone)}
                aria-label={t(language, 'call')}
                onClick={() => logCall({ name, phone })}
              >
                📞
              </a>
            ) : null
          }
        />

        {/* Rappel de l'annonce concernee : le vendeur sait de quoi on parle */}
        {fromAd?.adTitle ? (
          <p className="wizard__hint">
            🏷️ {t(language, 'about_ad')} : {fromAd.adTitle}
          </p>
        ) : null}

        <div className="chat-frame">
          {threadLoading ? <Spinner /> : null}
          {!threadLoading && !messages.length ? (
            <p className="chat-frame__empty">💬 {t(language, 'no_messages')}</p>
          ) : null}

          <div className="chat-frame__list">
            {[...messages].reverse().map((message) => {
              const mine = message.sender_id === user?.id;
              return (
                <div key={message.id} className={`bubble ${mine ? 'bubble--mine' : 'bubble--other'}`}>
                  {message.kind === 'voice' ? (
                    <AudioPlayButton storageKey={message.audio_key} seconds={message.audio_seconds} size="small" />
                  ) : (
                    <p className="bubble__text">
                      {/* Lien de l'annonce (ou tout autre lien) rendu cliquable :
                          lien interne -> on reste dans l'application. */}
                      {splitLinks(message.body).map((part, index) => {
                        if (part.type !== 'link') return <span key={index}>{part.value}</span>;
                        const path = localPathFromUrl(part.value);
                        return path ? (
                          <Link key={index} className="bubble__link" to={path}>
                            {part.value}
                          </Link>
                        ) : (
                          <a
                            key={index}
                            className="bubble__link"
                            href={part.value}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {part.value}
                          </a>
                        );
                      })}
                    </p>
                  )}
                  <span className="bubble__time">{relativeTime(message.created_at)}</span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Barre de saisie collee en bas, comme WhatsApp */}
        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendText();
          }}
        >
          <input
            className="chat-composer__input"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t(language, 'write_message')}
            maxLength={1000}
          />
          {/* Micro quand le champ est vide, bouton d'envoi des qu'on ecrit */}
          {text.trim() ? (
            <button type="submit" className="chat-composer__send" aria-label={t(language, 'send')} disabled={sending}>
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

        <Sheet open={sheet === 'voice'} title={t(language, 'send_voice')} onClose={() => setSheet(null)}>
          <VoiceRecorder onRecorded={sendVoice} maxSeconds={60} label={t(language, 'speak')} />
        </Sheet>
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title={t(language, 'messages')} onBack={() => navigate('/home')} />
      {loading ? <Spinner /> : null}
      {!loading && !threads.length ? <EmptyState icon="💬" title={t(language, 'no_messages')} /> : null}
      <div className="thread-list">
        {threads.map((thread) => (
          <div className="thread-line" key={thread.other_id}>
            <button type="button" className="thread-row" onClick={() => navigate(`/messages/${thread.other_id}`)}>
              <span className="thread-row__avatar" aria-hidden="true">👤</span>
              <span className="thread-row__body">
                <strong>{thread.other_name || formatPhone(thread.other_phone)}</strong>
                <small>
                  {messagePreview({
                    kind: thread.last_kind,
                    body: thread.last_body,
                    transcript: thread.last_transcript,
                    file_name: thread.last_file_name,
                  })}
                </small>
              </span>
              {thread.unread ? <span className="thread-row__badge">{thread.unread}</span> : null}
            </button>
            {/* Appel direct, sans passer par la conversation (numero non masque) */}
            {thread.other_phone ? (
              <button
                type="button"
                className="thread-call"
                aria-label={`${t(language, 'call')} ${thread.other_name || formatPhone(thread.other_phone)}`}
                onClick={() => callThread(thread)}
              >
                📞
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <BigButton icon="🏠" label={t(language, 'account')} color="dark" onClick={() => navigate('/home')} />
    </div>
  );
}
