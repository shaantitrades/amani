/**
 * Aides d'affichage des messages (discussion de groupe ou conversation privee).
 * Logique pure et testable : sert d'apercu dans les listes et de filtre
 * d'affichage dans les bulles.
 */

export const MESSAGE_KINDS = ['text', 'voice', 'image', 'file'];

/** Une courte ligne decrivant un message (listes de conversations). */
export function messagePreview(message) {
  if (!message) return '';
  switch (message.kind) {
    case 'voice':
      return message.transcript ? `🎙️ ${message.transcript}` : '🎙️ Message vocal';
    case 'image':
      return '📷 Photo';
    case 'file':
      return `📄 ${message.file_name || 'Document'}`;
    default:
      return message.body || message.transcript || '';
  }
}

export function isImageMessage(message) {
  return Boolean(message) && message.kind === 'image' && Boolean(message.file_key);
}

export function isFileMessage(message) {
  return Boolean(message) && message.kind === 'file' && Boolean(message.file_key);
}

export function isVoiceMessage(message) {
  return Boolean(message) && message.kind === 'voice' && Boolean(message.audio_key);
}

/** Vignette a afficher pour une photo (repli sur l'image complete). */
export function imageKey(message) {
  if (!isImageMessage(message)) return null;
  return message.thumb_key || message.file_key;
}

/** Extensions autorisees pour les documents (miroir du serveur). */
export const ALLOWED_FILE_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'rtf',
  'odt',
  'ods',
  'zip',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
];

export function fileExtension(name = '') {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match ? match[1] : '';
}

/**
 * Verifie un fichier cote client avant l'envoi (retour immediat a l'utilisateur
 * sans consommer de donnees mobiles).
 * @returns {{ok: boolean, reason?: 'extension'|'size'}}
 */
export function validateFileForUpload(file, maxBytes = 5 * 1024 * 1024) {
  if (!file) return { ok: false, reason: 'extension' };
  if (!ALLOWED_FILE_EXTENSIONS.includes(fileExtension(file.name))) return { ok: false, reason: 'extension' };
  if (file.size > maxBytes) return { ok: false, reason: 'size' };
  return { ok: true };
}

export default {
  MESSAGE_KINDS,
  messagePreview,
  isImageMessage,
  isFileMessage,
  isVoiceMessage,
  imageKey,
  ALLOWED_FILE_EXTENSIONS,
  fileExtension,
  validateFileForUpload,
};
