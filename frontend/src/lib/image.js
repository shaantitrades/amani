/**
 * Compression des photos cote client.
 *
 * Objectif du cahier des charges : images en WebP < 100 Ko par defaut, pour
 * respecter le forfait data de l'utilisateur et accelerer l'envoi en 2G/3G.
 * Le serveur recompresse une seconde fois (defense en profondeur + vignette).
 */

export const TARGET_BYTES = 102400; // 100 Ko
export const MAX_WIDTH = 1080;

function supportsWebp() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* repli sur <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Photo illisible'));
    };
    img.src = url;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}

/**
 * Redimensionne et compresse une photo.
 * @param {File|Blob} file
 * @param {{maxWidth?: number, targetBytes?: number}} [options]
 * @returns {Promise<{blob: Blob, width: number, height: number, quality: number, type: string}>}
 */
export async function compressImage(file, options = {}) {
  const maxWidth = options.maxWidth || MAX_WIDTH;
  const targetBytes = options.targetBytes || TARGET_BYTES;
  const bitmap = await loadBitmap(file);
  const srcWidth = bitmap.width || bitmap.naturalWidth;
  const srcHeight = bitmap.height || bitmap.naturalHeight;
  const ratio = Math.min(1, maxWidth / (srcWidth || maxWidth));
  const width = Math.max(1, Math.round((srcWidth || maxWidth) * ratio));
  const height = Math.max(1, Math.round((srcHeight || maxWidth) * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();

  const preferred = supportsWebp() ? 'image/webp' : 'image/jpeg';
  let quality = 0.7;
  let blob = await toBlob(canvas, preferred, quality);

  while (blob && blob.size > targetBytes && quality > 0.32) {
    quality -= 0.08;
    // eslint-disable-next-line no-await-in-loop
    blob = await toBlob(canvas, preferred, quality);
  }
  if (!blob) blob = await toBlob(canvas, 'image/jpeg', 0.6);

  return { blob, width, height, quality: Number(quality.toFixed(2)), type: preferred };
}

/** Redimensionne aussi les photos de profil (cible 60 Ko). */
export async function compressAvatar(file) {
  return compressImage(file, { maxWidth: 512, targetBytes: 60 * 1024 });
}

export default { compressImage, compressAvatar, TARGET_BYTES };
