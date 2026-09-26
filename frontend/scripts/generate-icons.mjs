import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generateur d'icones PWA sans dependance externe.
 * Encode les PNG a la main (zlib + CRC32) : rien a installer, resultat verifiable.
 *
 * Dessin : fond vert WhatsApp fonce (#075E54) + bulle verte (#25D366) et un "B"
 * blanc construit avec des rectangles et des anneaux (aucune police requise).
 */

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ---------------------------------------------------------------------------
// Encodeur PNG minimal (RGBA, 8 bits, sans filtre)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filtre "None"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits par canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Composition de l'image
// ---------------------------------------------------------------------------
function hexToRgba(hex) {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), 255];
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  canvas.data[i] = color[0];
  canvas.data[i + 1] = color[1];
  canvas.data[i + 2] = color[2];
  canvas.data[i + 3] = color[3];
}

/** Rectangle a coins arrondis (coordonnees normalisees 0..1). */
function roundedRect(canvas, x0, y0, x1, y1, radius, color) {
  const S = canvas.size;
  const px0 = x0 * S;
  const py0 = y0 * S;
  const px1 = x1 * S;
  const py1 = y1 * S;
  const r = (radius || 0) * S;
  for (let y = Math.floor(py0); y < Math.ceil(py1); y += 1) {
    for (let x = Math.floor(px0); x < Math.ceil(px1); x += 1) {
      const cx = Math.min(Math.max(x + 0.5, px0 + r), px1 - r);
      const cy = Math.min(Math.max(y + 0.5, py0 + r), py1 - r);
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) setPixel(canvas, x, y, color);
    }
  }
}

function circle(canvas, cx, cy, radius, color) {
  const S = canvas.size;
  const cxp = cx * S;
  const cyp = cy * S;
  const r = radius * S;
  for (let y = Math.floor(cyp - r); y <= Math.ceil(cyp + r); y += 1) {
    for (let x = Math.floor(cxp - r); x <= Math.ceil(cxp + r); x += 1) {
      if (Math.hypot(x + 0.5 - cxp, y + 0.5 - cyp) <= r) setPixel(canvas, x, y, color);
    }
  }
}

/** Anneau (cercle evide) : dessine les boucles du "B". */
function ring(canvas, cx, cy, rOuter, rInner, color) {
  const S = canvas.size;
  const cxp = cx * S;
  const cyp = cy * S;
  const ro = rOuter * S;
  const ri = rInner * S;
  for (let y = Math.floor(cyp - ro); y <= Math.ceil(cyp + ro); y += 1) {
    for (let x = Math.floor(cxp - ro); x <= Math.ceil(cxp + ro); x += 1) {
      const d = Math.hypot(x + 0.5 - cxp, y + 0.5 - cyp);
      if (d <= ro && d >= ri) setPixel(canvas, x, y, color);
    }
  }
}

/**
 * @param {number} size taille en pixels
 * @param {boolean} maskable true = fond plein bord a bord, contenu reduit (zone sure)
 */
export function makeIcon(size, maskable = false) {
  const bg = hexToRgba('#075E54');
  const green = hexToRgba('#25D366');
  const white = hexToRgba('#FFFFFF');
  const canvas = { size, data: Buffer.alloc(size * size * 4, 0) };

  if (maskable) {
    roundedRect(canvas, 0, 0, 1, 1, 0, bg);
  } else {
    roundedRect(canvas, 0.02, 0.02, 0.98, 0.98, 0.2, bg);
  }

  const scale = maskable ? 0.62 : 0.78; // zone sure pour les icones maskables
  const r = scale / 2;
  const cx = 0.5;
  const cy = 0.46;

  // Bulle verte + queue de la bulle (en bas a gauche)
  circle(canvas, cx, cy, r, green);
  const tailHeight = Math.round(r * size * 0.5);
  for (let i = 0; i < tailHeight; i += 1) {
    const w = Math.round(i * 0.55);
    for (let k = 0; k < w; k += 1) {
      setPixel(
        canvas,
        Math.round(cx * size) - Math.round(r * size * 0.55) - k,
        Math.round((cy + r) * size) + i,
        green,
      );
    }
  }

  // Lettre "B" blanche : hampe + deux boucles
  const stemX = cx - r * 0.44;
  const stemW = r * 0.16;
  roundedRect(canvas, stemX, cy - r * 0.5, stemX + stemW, cy + r * 0.5, stemW * 0.35, white);
  ring(canvas, cx - r * 0.02, cy - r * 0.24, r * 0.26, r * 0.1, white);
  ring(canvas, cx - r * 0.02, cy + r * 0.24, r * 0.32, r * 0.12, white);

  return encodePng(size, size, canvas.data);
}

/** Verifie la signature et les dimensions d'un PNG (auto-controle du script). */
export function readPngInfo(buffer) {
  return {
    signatureOk: buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
    bytes: buffer.length,
  };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const targets = [
    { file: 'icon-192.png', size: 192, maskable: false },
    { file: 'icon-512.png', size: 512, maskable: false },
    { file: 'maskable-512.png', size: 512, maskable: true },
    { file: 'apple-touch-icon.png', size: 180, maskable: false },
  ];

  for (const target of targets) {
    const buffer = makeIcon(target.size, target.maskable);
    const file = path.join(OUT_DIR, target.file);
    writeFileSync(file, buffer);
    const info = readPngInfo(readFileSync(file));
    if (!info.signatureOk || info.width !== target.size || info.height !== target.size) {
      throw new Error(`Icone invalide : ${target.file}`);
    }
    console.log(`  ${target.file.padEnd(22)} ${info.width}x${info.height}  ${(info.bytes / 1024).toFixed(1)} Ko  OK`);
  }
  console.log(`Icones generees dans ${OUT_DIR}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
