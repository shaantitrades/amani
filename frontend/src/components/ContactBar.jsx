import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { t } from '../i18n/index.js';
import { formatPhone, telLink } from '../lib/format.js';
import { api } from '../lib/api.js';
import { logCall } from '../lib/calls.js';
import { chatPath, chatStateFromAd } from '../lib/chat.js';
import { VoiceRecorder } from './media.jsx';
import { BigButton, Sheet } from './ui.jsx';

/**
 * Barre de contact : l'acheteur voit le numero du vendeur (aucun masquage),
 * peut appeler ou **discuter dans Bodogui** (bouton DISCUTER : la conversation
 * s'ouvre dans l'application, aucun renvoi vers WhatsApp ou un autre service),
 * et garde le message vocal, qui ne demande pas d'ecrire.
 */
export function ContactBar({ ad, onSent }) {
  const navigate = useNavigate();
  const { language, showToast, user, announce } = useApp();
  const [contact, setContact] = useState(null);
  const [sheet, setSheet] = useState(null); // 'voice' | null
  const [sending, setSending] = useState(false);
  const isOwner = user?.id === ad.owner_id;

  const loadContact = async () => {
    if (contact) return contact;
    try {
      const data = await api.get(`/ads/${ad.id}/contact`);
      setContact(data);
      return data;
    } catch (err) {
      showToast(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey });
      return null;
    }
  };

  const call = async () => {
    const data = await loadContact();
    if (!data) return;
    // L'appel est journalise sur l'appareil : il apparait dans l'onglet Appels.
    await logCall({ name: data.owner_name || ad.title, phone: data.phone, adId: ad.id });
    announce('call_started');
    window.location.href = data.tel_link || telLink(data.phone);
  };

  /** Conversation interne : on ouvre le fil avec le vendeur, dans l'application. */
  const discuss = () => {
    navigate(chatPath(ad.owner_id), { state: chatStateFromAd(ad) });
  };

  const sendVoice = async (recorded) => {
    setSending(true);
    try {
      const form = new FormData();
      form.append('audio', recorded.blob, 'voice.webm');
      form.append('seconds', String(recorded.seconds));
      form.append('scope', 'message');
      const upload = await api.upload('/media/audio', form);
      await api.post('/messages', {
        recipient_id: ad.owner_id,
        ad_id: ad.id,
        kind: 'voice',
        audio_key: upload.key,
        audio_seconds: upload.seconds,
      });
      setSheet(null);
      showToast(t(language, 'send_voice'), { kind: 'success', voiceKey: 'interest_sent' });
      if (onSent) onSent();
    } catch (err) {
      showToast(t(language, 'error_generic'), { kind: 'error', voiceKey: err.voiceKey || 'error_generic' });
    } finally {
      setSending(false);
    }
  };

  if (isOwner) {
    return (
      <div className="contact-bar">
        <span className="contact-bar__hint">{t(language, 'my_ads')}</span>
      </div>
    );
  }

  return (
    <>
      <div className="contact-bar">
        <BigButton icon="📞" label={t(language, 'call')} color="green" size="large" onClick={call} />
        <BigButton icon="💬" label={t(language, 'discuss')} color="teal" size="large" onClick={discuss} />
        <BigButton icon="🎙️" label={t(language, 'send_voice')} color="blue" onClick={() => setSheet('voice')} />
      </div>

      {contact ? <p className="contact-bar__phone">{formatPhone(contact.phone)}</p> : null}

      <Sheet open={sheet === 'voice'} title={t(language, 'send_voice')} onClose={() => setSheet(null)}>
        <VoiceRecorder
          onRecorded={sendVoice}
          hint={t(language, 'safety')}
          label={sending ? t(language, 'loading') : t(language, 'speak')}
        />
      </Sheet>
    </>
  );
}

export default ContactBar;
