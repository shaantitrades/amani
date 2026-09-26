import env from '../config/env.js';
import logger from '../lib/logger.js';

/**
 * Transcription vocale (optionnelle, Phase 2).
 *  - none   : desactive (le client propose alors les categories proches)
 *  - local  : serveur Whisper auto-heberge (whisper.cpp server, faster-whisper, wyoming)
 *  - google : Google Cloud Speech-to-Text (REST, cle API)
 *
 * L'API reste identique : transcript ou null.
 */
export function sttEnabled() {
  return env.STT_PROVIDER !== 'none';
}

async function transcribeLocal(buffer, mimeType, language) {
  if (!env.WHISPER_URL) return null;
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/ogg' }), 'voice.ogg');
  if (language) form.append('language', language);
  const res = await fetch(env.WHISPER_URL, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Whisper HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.text || data.transcript || '').trim() || null;
}

async function transcribeGoogle(buffer, mimeType, language) {
  if (!env.GOOGLE_STT_API_KEY) return null;
  const encoding = mimeType?.includes('ogg') ? 'OGG_OPUS' : mimeType?.includes('webm') ? 'WEBM_OPUS' : 'MP3';
  const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${env.GOOGLE_STT_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        encoding,
        sampleRateHertz: encoding.includes('OPUS') ? 48000 : undefined,
        languageCode: language === 'ar' ? 'ar' : 'fr-FR',
        alternativeLanguageCodes: ['ar', 'fu', 'fr-FR'],
        enableAutomaticPunctuation: false,
      },
      audio: { content: buffer.toString('base64') },
    }),
  });
  if (!res.ok) throw new Error(`Google STT HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.results?.[0]?.alternatives?.[0]?.transcript || '').trim() || null;
}

/**
 * Transcrit un message vocal. Ne jette jamais : renvoie null en cas d'echec
 * (la publication d'annonce ne doit jamais dependre du STT).
 */
export async function transcribe(buffer, { mimeType = 'audio/ogg', language = 'fr' } = {}) {
  if (!sttEnabled()) return null;
  try {
    if (env.STT_PROVIDER === 'local') return await transcribeLocal(buffer, mimeType, language);
    if (env.STT_PROVIDER === 'google') return await transcribeGoogle(buffer, mimeType, language);
    return null;
  } catch (err) {
    logger.warn({ err: err.message }, 'Transcription vocale echouee (ignoree)');
    return null;
  }
}

export default { transcribe, sttEnabled };
