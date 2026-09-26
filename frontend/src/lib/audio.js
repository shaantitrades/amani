/**
 * Enregistrement audio (Opus) et lecture des messages vocaux.
 *
 * Choix techniques :
 *  - Opus a 24 kbps : environ 50 Ko pour 30 s (objectif du cahier des charges)
 *  - 60 s maximum, avec minuteur visible et coupe automatique
 *  - repli sur video/webm ou audio/mp4 selon le navigateur (Android 5 / iOS)
 *
 * Les erreurs du micro sont classees par `code` (denied, missing, busy,
 * insecure, unsupported) afin d'afficher un message utile a l'utilisateur
 * au lieu d'une "erreur generique".
 */

import { secureContextOk } from './secure.js';

export const MAX_AUDIO_SECONDS = 60;
export const AUDIO_BITRATE = 24000;
/** Duree minimale consideree comme volontaire (en dessous : appui accidentel). */
export const MIN_AUDIO_SECONDS = 1;

const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
];

export function pickAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

export function recordingSupported() {
  return microphoneIssue() === null;
}

/**
 * Probleme empechant l'enregistrement.
 * @returns {null|'insecure'|'unsupported'}
 */
export function microphoneIssue() {
  if (typeof navigator === 'undefined') return 'unsupported';
  if (!secureContextOk()) return 'insecure';
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return 'unsupported';
  if (typeof MediaRecorder === 'undefined') return 'unsupported';
  return null;
}

/**
 * Classe une erreur `getUserMedia` pour l'interface.
 * @returns {'denied'|'missing'|'busy'|'unknown'}
 */
export function microphoneError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'missing';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'unknown';
  }
}

/** Erreur d'enregistrement enrichie d'un `code` exploitable par l'interface. */
function recordingFailure(error, code) {
  const failure = new Error(error?.message || 'Micro indisponible');
  failure.name = 'RecordingError';
  failure.code = code;
  failure.cause = error;
  return failure;
}

/**
 * Controleur d'enregistrement.
 * Usage : const rec = await startRecording({ onTick }); const result = await rec.stop();
 */
export async function startRecording({ onTick, onAutoStop, maxSeconds = MAX_AUDIO_SECONDS } = {}) {
  const issue = microphoneIssue();
  if (issue) throw recordingFailure(null, issue);

  const mimeType = pickAudioMimeType();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
    });
  } catch (error) {
    throw recordingFailure(error, microphoneError(error));
  }

  const options = { audioBitsPerSecond: AUDIO_BITRATE };
  if (mimeType) options.mimeType = mimeType;
  let recorder;
  try {
    recorder = new MediaRecorder(stream, options);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw recordingFailure(error, microphoneError(error));
  }
  const chunks = [];
  const startedAt = Date.now();
  let timer = null;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  recorder.start(1000);

  if (onTick) {
    timer = setInterval(() => {
      const seconds = Math.min(maxSeconds, Math.round((Date.now() - startedAt) / 1000));
      onTick(seconds);
      if (seconds >= maxSeconds) {
        if (onAutoStop) onAutoStop();
        try {
          recorder.stop();
        } catch {
          /* deja arrete */
        }
      }
    }, 250);
  }

  const cleanup = () => {
    clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
  };

  return {
    mimeType: mimeType || 'audio/webm',
    seconds: () => Math.round((Date.now() - startedAt) / 1000),
    stop() {
      return new Promise((resolve, reject) => {
        if (recorder.state === 'inactive') {
          cleanup();
          const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          resolve({ blob, seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)), mimeType });
          return;
        }
        recorder.onstop = () => {
          cleanup();
          const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
          if (!blob.size) reject(new Error('Enregistrement vide'));
          else resolve({ blob, seconds: Math.min(seconds, maxSeconds), mimeType: recorder.mimeType || mimeType });
        };
        recorder.onerror = (event) => {
          cleanup();
          reject(event.error || new Error('Erreur d\'enregistrement'));
        };
        try {
          recorder.stop();
        } catch (err) {
          cleanup();
          reject(err);
        }
      });
    },
    cancel() {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
      cleanup();
    },
  };
}

/** Lecteur audio unique (evite les lectures simultanees). */
let current = null;

export function playAudioUrl(url, { onEnded } = {}) {
  return new Promise((resolve, reject) => {
    stopAudio();
    const audio = new Audio(url);
    audio.preload = 'auto';
    current = audio;
    audio.onended = () => {
      current = null;
      if (onEnded) onEnded();
      resolve();
    };
    audio.onerror = () => {
      current = null;
      reject(new Error('Lecture impossible'));
    };
    audio.play().catch(reject);
  });
}

export function playBlob(blob, options) {
  const url = URL.createObjectURL(blob);
  return playAudioUrl(url, options).finally(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
}

export function stopAudio() {
  if (current) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

export default {
  startRecording,
  playAudioUrl,
  playBlob,
  stopAudio,
  recordingSupported,
  microphoneIssue,
  microphoneError,
  MAX_AUDIO_SECONDS,
  MIN_AUDIO_SECONDS,
};
