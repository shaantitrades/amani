import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { categoryLabel, districtLabel, t } from '../i18n/index.js';
import { formatDuration, formatPrice } from '../lib/format.js';
import { mediaUrl } from '../lib/api.js';
import {
  playBlob,
  playAudioUrl,
  startRecording,
  stopAudio,
  microphoneIssue,
  MAX_AUDIO_SECONDS,
  MIN_AUDIO_SECONDS,
} from '../lib/audio.js';
import { compressImage } from '../lib/image.js';
import { speakNumber } from '../lib/voice.js';
import { BigButton, IconButton } from './ui.jsx';

/** Lecture d'un message vocal (gros bouton ▶️). */
export function AudioPlayButton({ storageKey, blob, seconds, label, color = 'blue', size = 'normal' }) {
  const { language, showToast } = useApp();
  const [playing, setPlaying] = useState(false);

  const toggle = async () => {
    if (playing) {
      stopAudio();
      setPlaying(false);
      return;
    }
    try {
      setPlaying(true);
      const url = blob ? URL.createObjectURL(blob) : mediaUrl(storageKey);
      await playAudioUrl(url);
    } catch {
      showToast(t(language, 'error_generic'), { kind: 'error', voiceKey: 'error_audio_empty' });
    } finally {
      setPlaying(false);
    }
  };

  return (
    <BigButton
      icon={playing ? '⏸' : '▶️'}
      label={label || (seconds ? formatDuration(seconds) : t(language, 'listen'))}
      color={color}
      size={size}
      onClick={toggle}
      ariaLabel={t(language, 'listen_description')}
    />
  );
}

/**
 * Codes d'erreur du micro -> cle de message (interface et message vocal).
 * Les deux catalogues (fr.js et voice.js) partagent ces cles.
 */
const MIC_ISSUE_KEYS = {
  denied: 'error_mic_denied',
  missing: 'error_mic_missing',
  busy: 'error_mic_busy',
  insecure: 'error_insecure_context',
  unsupported: 'error_mic_missing',
  unknown: 'error_generic',
};

/**
 * Gros bouton "Parler" : un appui demarre l'enregistrement, un second appui
 * l'arrete et garde le message. Minuteur visible et coupe automatique a 60 s.
 *
 * Regression corrigee : le bouton demarrait sur `pointerdown` et s'arretait sur
 * `pointerup`. Comme `getUserMedia` est asynchrone, un simple appui (relachement
 * immediat) arretait le micro des qu'il venait de demarrer, ce qui produisait un
 * message d'une seconde. Le clic (demarrer / arreter) supprime cette course et
 * toute prise plus courte que MIN_AUDIO_SECONDS est ecartee avec une explication.
 */
export function VoiceRecorder({ onRecorded, onCancel, maxSeconds = MAX_AUDIO_SECONDS, label, hint }) {
  const { language, showToast, announce } = useApp();
  const [state, setState] = useState('idle'); // idle | starting | recording | ready
  const [seconds, setSeconds] = useState(0);
  const [recorded, setRecorded] = useState(null);
  const recorderRef = useRef(null);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
      recorderRef.current?.cancel();
    },
    [],
  );

  const report = (code) => {
    const key = MIC_ISSUE_KEYS[code] || 'error_generic';
    showToast(t(language, key), { kind: 'error', voiceKey: key });
  };

  const finish = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setState('idle');
    const elapsed = (Date.now() - startedAtRef.current) / 1000;
    try {
      const result = await recorder.stop();
      if (elapsed < MIN_AUDIO_SECONDS) {
        // Appui trop bref ou double appui : on repart proprement, sans message utile
        setSeconds(0);
        showToast(t(language, 'error_audio_short'), { kind: 'info', voiceKey: 'error_audio_short' });
        announce('error_audio_short');
        return;
      }
      setRecorded(result);
      setState('ready');
      announce('recording_stop');
      if (onRecorded) onRecorded(result);
    } catch {
      announce('error_audio_empty');
      setState('idle');
    }
  };

  const begin = async () => {
    if (state !== 'idle') return;
    const issue = microphoneIssue();
    if (issue) {
      // Contexte non securise ou appareil sans micro : on explique au lieu
      // d'echouer silencieusement.
      report(issue);
      return;
    }
    setState('starting');
    try {
      const recorder = await startRecording({
        maxSeconds,
        onTick: setSeconds,
        onAutoStop: () => finish(),
      });
      // L'utilisateur a pu quitter l'ecran pendant la demande d'autorisation :
      // on libere le micro au lieu de laisser la capture ouverte.
      if (!mountedRef.current) {
        recorder.cancel();
        return;
      }
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setSeconds(0);
      setState('recording');
      announce('recording_start');
    } catch (err) {
      recorderRef.current = null;
      setSeconds(0);
      setState('idle');
      report(err?.code || 'unknown');
    }
  };

  const reset = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecorded(null);
    setSeconds(0);
    setState('idle');
    if (onCancel) onCancel();
  };

  if (state === 'ready' && recorded) {
    return (
      <div className="recorder recorder--ready">
        <AudioPlayButton
          blob={recorded.blob}
          seconds={recorded.seconds}
          label={t(language, 'replay')}
          color="green"
          size="large"
        />
        <BigButton icon="🎙️" label={t(language, 'record_again')} color="grey" onClick={reset} />
      </div>
    );
  }

  const issue = microphoneIssue();
  const preparing = state === 'starting';
  const active = state === 'recording';

  return (
    <div className="recorder">
      <button
        type="button"
        className={`mic-button ${active ? 'mic-button--active' : ''} ${preparing ? 'mic-button--busy' : ''}`}
        onClick={active ? finish : begin}
        disabled={preparing}
        aria-pressed={active}
        aria-label={label || t(language, 'speak')}
      >
        <span className="mic-button__icon" aria-hidden="true">{preparing ? '⏳' : active ? '⏹' : '🎙️'}</span>
        <span className="mic-button__label">
          {preparing
            ? t(language, 'preparing_mic')
            : active
              ? `${formatDuration(seconds)} / ${formatDuration(maxSeconds)}`
              : label || t(language, 'speak')}
        </span>
        {preparing ? null : (
          <span className="mic-button__sub">{active ? t(language, 'tap_to_stop') : t(language, 'tap_to_record')}</span>
        )}
      </button>
      {active ? <BigButton icon="✖️" label={t(language, 'cancel')} color="grey" onClick={reset} /> : null}
      {issue === 'insecure' ? <p className="recorder__hint">🔒 {t(language, 'error_insecure_context')}</p> : null}
      {hint ? <p className="recorder__hint">{hint}</p> : null}
    </div>
  );
}

export default { AudioPlayButton, VoiceRecorder };
