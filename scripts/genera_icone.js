// Genera le icone PNG/ICO del sito dal disegno del calendario (lo stesso di favicon.svg).
// Nessuna dipendenza: rasterizzazione con supersampling + PNG scritto a mano con zlib.
//
// Uso: node scripts/genera_icone.js   → scrive in icons/
//   favicon.ico (16+32+48, per preferiti e browser vecchi), favicon-32.png,
//   apple-touch-icon.png (180, iPhone/iPad), icon-192.png e icon-512.png (Android),
//   icon-maskable-512.png (Android, icona adattiva con margine di sicurezza).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SFONDO = [0x12, 0x13, 0x09];   // #121309
const OTTONE = [0xc9, 0x9a, 0x4a];   // #c99a4a
const OUT = path.join(__dirname, '..', 'icons');

// Rettangolo con angoli arrotondati (raggi diversi per angolo: tl, tr, br, bl)
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
  const angolo = (cx, cy, rr) => (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr;
  if (tl && x < x0 + tl && y < y0 + tl) return angolo(x0 + tl, y0 + tl, tl);
  if (tr && x > x1 - tr && y < y0 + tr) return angolo(x1 - tr, y0 + tr, tr);
  if (br && x > x1 - br && y > y1 - br) return angolo(x1 - br, y1 - br, br);
  if (bl && x < x0 + bl && y > y1 - bl) return angolo(x0 + bl, y1 - bl, bl);
  return true;
}

// Calendario nello spazio 24x24 di favicon.svg
function inCalendario(x, y) {
  const anelli = inRoundRect(x, y, 6, 2, 8, 6, [1, 1, 0, 0]) || inRoundRect(x, y, 16, 2, 18, 6, [1, 1, 0, 0]);
  const corpo = inRoundRect(x, y, 2, 4, 22, 22, 3) && !inRoundRect(x, y, 4, 10, 20, 20, [0, 0, 1, 1]);
  const giorno = x >= 6 && x <= 9 && y >= 12 && y <= 15;
  return anelli || corpo || giorno;
}

// opzioni: arrotondato = angoli dello sfondo arrotondati (trasparenti fuori),
//          scala = lato del calendario rispetto all'icona (0.625 come favicon.svg)
function disegna(lato, { arrotondato = true, scala = 0.625 } = {}) {
  const SS = 4; // 4x4 campioni per pixel
  const raggio = arrotondato ? lato * 14 / 64 : 0;
  const dim = lato * scala;
  const ox = (lato - dim) / 2;
  const oy = (lato - dim) / 2 - lato * 0.016; // leggermente più in alto, come nell'SVG
  const px = Buffer.alloc(lato * lato * 4);
  for (let py = 0; py < lato; py++) {
    for (let pxx = 0; pxx < lato; pxx++) {
      let copertura = 0, glifo = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = pxx + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (!inRoundRect(x, y, 0, 0, lato, lato, raggio)) continue;
          copertura++;
          if (inCalendario((x - ox) / dim * 24, (y - oy) / dim * 24)) glifo++;
        }
      }
      const i = (py * lato + pxx) * 4;
      const t = copertura ? glifo / copertura : 0;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(SFONDO[c] * (1 - t) + OTTONE[c] * t);
      px[i + 3] = Math.round(255 * copertura / (SS * SS));
    }
  }
  return png(lato, lato, px);
}

// --- PNG (RGBA 8 bit) ---
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(tipo, dati) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dati.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dati]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  const righe = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(righe, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(righe, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- ICO con PNG dentro (supportato da tutti i browser attuali) ---
function ico(immagini) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(immagini.length, 4);
  let offset = 6 + 16 * immagini.length;
  const voci = immagini.map(({ lato, dati }) => {
    const v = Buffer.alloc(16);
    v[0] = lato >= 256 ? 0 : lato; v[1] = lato >= 256 ? 0 : lato;
    v.writeUInt16LE(1, 4); v.writeUInt16LE(32, 6);
    v.writeUInt32LE(dati.length, 8); v.writeUInt32LE(offset, 12);
    offset += dati.length;
    return v;
  });
  return Buffer.concat([header, ...voci, ...immagini.map(i => i.dati)]);
}

fs.mkdirSync(OUT, { recursive: true });
const scrivi = (nome, dati) => { fs.writeFileSync(path.join(OUT, nome), dati); console.log(`${nome.padEnd(24)} ${dati.length} byte`); };

// Piccole: calendario più grande, altrimenti a 16 px non si legge
scrivi('favicon.ico', ico([16, 32, 48].map(l => ({ lato: l, dati: disegna(l, { scala: 0.75 }) }))));
scrivi('favicon-32.png', disegna(32, { scala: 0.75 }));
// iOS arrotonda da sé gli angoli: sfondo pieno
scrivi('apple-touch-icon.png', disegna(180, { arrotondato: false }));
scrivi('icon-192.png', disegna(192));
scrivi('icon-512.png', disegna(512));
// Maskable: sfondo pieno e calendario dentro la zona sicura (cerchio dell'80%)
scrivi('icon-maskable-512.png', disegna(512, { arrotondato: false, scala: 0.5 }));
