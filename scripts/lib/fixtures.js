/**
 * Builders for fictitious attachment files (development tools only: demo assets and the
 * Gmail test-letter seed). No external dependencies except sharp for images.
 */
import { crc32 } from 'node:zlib';

import sharp from 'sharp';

/** @param {string} text */
export const xmlEscape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Paper-like handwritten letter rendered from SVG.
 * @param {string[]} lines
 * @param {{ width?: number, height?: number, paper?: string, ink?: string }} [options]
 * @returns {Buffer}
 */
export function letterSvg(lines, { width = 1240, height = 1600, paper = '#fbf6e9', ink = '#1d2a6b' } = {}) {
  const text = lines
    .map(
      (line, i) =>
        `<text x="110" y="${190 + i * 70}" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="46" fill="${ink}">${xmlEscape(line)}</text>`,
    )
    .join('');
  const rules = Array.from(
    { length: Math.floor((height - 220) / 70) },
    (_, i) => `<line x1="80" x2="${width - 80}" y1="${205 + i * 70}" y2="${205 + i * 70}" stroke="#c9d6ea" stroke-width="2"/>`,
  ).join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${paper}"/><line x1="70" x2="70" y1="0" y2="${height}" stroke="#e7a9a9" stroke-width="3"/>${rules}${text}</svg>`,
  );
}

/**
 * Letter image in the requested format. `rotateExif` stores the pixels rotated with EXIF
 * Orientation=6 (like a phone photo that must be rotated to be read).
 * @param {string[]} lines
 * @param {{ format?: 'jpeg' | 'png' | 'webp' | 'gif', rotateExif?: boolean, width?: number, height?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export async function letterImage(lines, { format = 'jpeg', rotateExif = false, width, height } = {}) {
  let image = sharp(letterSvg(lines, { width, height }));
  if (rotateExif) image = image.rotate(-90);
  if (format === 'png') image = image.png();
  else if (format === 'webp') image = image.webp({ quality: 80 });
  else if (format === 'gif') image = image.gif();
  else image = image.jpeg({ quality: 82 });
  if (rotateExif) image = image.withMetadata({ orientation: 6 });
  return image.toBuffer();
}

/**
 * Simple drawing (photo-like) with a caption.
 * @param {string} caption
 * @param {{ background?: string, format?: 'png' | 'jpeg' }} [options]
 * @returns {Promise<Buffer>}
 */
export async function drawing(caption, { background = '#d9c5a3', format = 'png' } = {}) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="100%" height="100%" fill="${background}"/><circle cx="240" cy="140" r="80" fill="#f4d35e"/><circle cx="210" cy="125" r="10" fill="#222"/><circle cx="270" cy="125" r="10" fill="#222"/><path d="M200 170 Q240 205 280 170" stroke="#222" stroke-width="8" fill="none"/><text x="240" y="295" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#222">${xmlEscape(caption)}</text></svg>`,
  );
  const image = sharp(svg);
  return format === 'jpeg' ? image.jpeg({ quality: 85 }).toBuffer() : image.png().toBuffer();
}

/**
 * Minimal single-page PDF (Helvetica, WinAnsi) with correct xref offsets.
 * @param {string[]} lines
 * @returns {Buffer}
 */
export function buildPdf(lines) {
  const winAnsi = (/** @type {string} */ s) =>
    s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, (c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`);
  const content = ['BT', '/F1 13 Tf', '16 TL', '72 760 Td', ...lines.map((line) => `(${winAnsi(line)}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * Store-only ZIP writer.
 * @param {Array<{ name: string, data: string | Buffer }>} entries
 * @returns {Buffer}
 */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * Minimal .docx with one paragraph per line ('' = empty paragraph).
 * @param {string[]} paragraphs
 * @returns {Buffer}
 */
export function buildDocx(paragraphs) {
  const body = paragraphs
    .map((p) => (p ? `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>` : '<w:p/>'))
    .join('');
  return buildZip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    },
  ]);
}

/** Bytes that look like a QuickTime movie header (unsupported attachment). */
export function fakeMov() {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  \x00\x00\x02\x00qt  ', 'latin1'), Buffer.alloc(2048, 0)]);
}

/** Bytes with a HEIC signature that prebuilt sharp cannot decode (tests the fallback). */
export function fakeHeic() {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic\x00\x00\x00\x00mif1heic', 'latin1'), Buffer.alloc(4096, 7)]);
}

/**
 * Scenes for the illustrated test letters (800×500). Plain SVG shapes only, so they render
 * the same on every machine.
 */
const SCENES = Object.freeze({
  /** Mountains at sunset. */
  sunset: () =>
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2d6e"/><stop offset=".55" stop-color="#e2725b"/><stop offset="1" stop-color="#f6c36b"/></linearGradient></defs>
     <rect width="800" height="500" fill="url(#sky)"/><circle cx="560" cy="300" r="70" fill="#ffd27a" opacity=".95"/>
     <polygon points="0,500 0,330 140,220 260,320 380,190 520,330 640,240 800,350 800,500" fill="#3c3a5f"/>
     <polygon points="0,500 0,400 180,320 330,410 470,330 620,420 800,380 800,500" fill="#26243f"/>
     <g fill="#fff" opacity=".8"><circle cx="90" cy="60" r="2"/><circle cx="200" cy="40" r="1.5"/><circle cx="330" cy="80" r="2"/><circle cx="700" cy="50" r="1.5"/></g>`,
  /** Calm sea with a sailing boat. */
  sea: () =>
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd3f4"/><stop offset="1" stop-color="#e0f4ff"/></linearGradient>
     <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f7fb8"/><stop offset="1" stop-color="#0b3d63"/></linearGradient></defs>
     <rect width="800" height="500" fill="url(#sky)"/><circle cx="650" cy="90" r="45" fill="#fff4b0"/>
     <rect y="280" width="800" height="220" fill="url(#water)"/>
     <g fill="none" stroke="#bfe6ff" stroke-width="3" opacity=".7"><path d="M40 330 q30 -12 60 0 t60 0"/><path d="M420 360 q30 -12 60 0 t60 0"/><path d="M200 420 q30 -12 60 0 t60 0"/><path d="M600 440 q30 -12 60 0 t60 0"/></g>
     <polygon points="300,275 470,275 445,305 325,305" fill="#7a4b2a"/><rect x="383" y="140" width="5" height="135" fill="#5a3a20"/>
     <polygon points="391,145 391,265 470,265" fill="#fdfdfd"/><polygon points="380,160 380,265 320,265" fill="#f2d7a7"/>
     <g fill="none" stroke="#334" stroke-width="3"><path d="M150 120 q12 -12 24 0 q12 -12 24 0"/><path d="M230 90 q9 -9 18 0 q9 -9 18 0"/></g>`,
  /** A cheerful dog on the grass, with a ball. */
  dog: () =>
    `<rect width="800" height="500" fill="#bfe3f2"/><rect y="340" width="800" height="160" fill="#7cc36b"/>
     <path d="M255 300 q-60 -60 -30 -110" stroke="#c98b4e" stroke-width="22" fill="none" stroke-linecap="round"/>
     <ellipse cx="400" cy="330" rx="150" ry="85" fill="#c98b4e"/><ellipse cx="530" cy="240" rx="80" ry="72" fill="#c98b4e"/>
     <ellipse cx="585" cy="180" rx="26" ry="55" fill="#8a5a2e" transform="rotate(25 585 180)"/><ellipse cx="480" cy="185" rx="26" ry="55" fill="#8a5a2e" transform="rotate(-25 480 185)"/>
     <circle cx="510" cy="230" r="10" fill="#222"/><circle cx="555" cy="230" r="10" fill="#222"/><ellipse cx="560" cy="268" rx="16" ry="11" fill="#222"/>
     <path d="M520 285 q25 22 50 0" stroke="#222" stroke-width="5" fill="none"/><ellipse cx="545" cy="302" rx="12" ry="16" fill="#e86a7a"/>
     <rect x="300" y="380" width="30" height="70" rx="12" fill="#a8703c"/><rect x="360" y="390" width="30" height="62" rx="12" fill="#a8703c"/><rect x="440" y="390" width="30" height="62" rx="12" fill="#a8703c"/><rect x="490" y="380" width="30" height="70" rx="12" fill="#a8703c"/>
     <circle cx="170" cy="430" r="34" fill="#f2c94c"/><path d="M140 418 q30 20 60 0" stroke="#fff" stroke-width="5" fill="none"/>`,
  /** A child's crayon drawing: house, sun and family holding hands. */
  crayon: () =>
    `<rect width="800" height="500" fill="#fffdf7"/>
     <g fill="none" stroke-linecap="round" stroke-linejoin="round">
       <circle cx="680" cy="95" r="48" stroke="#f5b700" stroke-width="9"/>
       <g stroke="#f5b700" stroke-width="7"><path d="M680 30 v-20"/><path d="M730 50 l14 -12"/><path d="M740 105 h20"/><path d="M630 50 l-14 -12"/><path d="M620 105 h-20"/></g>
       <path d="M90 300 l120 -110 l120 110 z" stroke="#d1495b" stroke-width="8"/><rect x="110" y="300" width="200" height="150" stroke="#3d5a80" stroke-width="8"/>
       <rect x="185" y="370" width="50" height="80" stroke="#8d6346" stroke-width="7"/><rect x="130" y="320" width="40" height="38" stroke="#3d5a80" stroke-width="6"/>
       <g stroke="#2a9d8f" stroke-width="7"><circle cx="430" cy="300" r="26"/><path d="M430 326 v80 M430 406 l-25 45 M430 406 l25 45 M400 350 h130"/>
       <circle cx="530" cy="315" r="20"/><path d="M530 335 v60 M530 395 l-18 38 M530 395 l18 38 M530 350 h90"/>
       <circle cx="620" cy="300" r="26"/><path d="M620 326 v80 M620 406 l-25 45 M620 406 l25 45"/></g>
       <path d="M0 470 q100 -15 200 0 t200 0 t200 0 t200 0" stroke="#6ab04c" stroke-width="10"/>
     </g>`,
  /** Birthday cake with candles. */
  cake: () =>
    `<rect width="800" height="500" fill="#fde2e4"/><g fill="#fff" opacity=".6"><circle cx="80" cy="80" r="10"/><circle cx="720" cy="120" r="14"/><circle cx="650" cy="40" r="8"/><circle cx="150" cy="200" r="6"/></g>
     <ellipse cx="400" cy="440" rx="260" ry="30" fill="#d9a5b3"/>
     <rect x="200" y="330" width="400" height="105" rx="16" fill="#8d5a3b"/><path d="M200 350 q50 30 100 0 t100 0 t100 0 t100 0" fill="#fff6e9"/>
     <rect x="250" y="250" width="300" height="85" rx="14" fill="#f4a7b9"/><path d="M250 268 q37 25 75 0 t75 0 t75 0 t75 0" fill="#fff"/>
     <g fill="#7ec8e3"><rect x="300" y="190" width="14" height="60" rx="4"/><rect x="360" y="180" width="14" height="70" rx="4"/><rect x="426" y="180" width="14" height="70" rx="4"/><rect x="486" y="190" width="14" height="60" rx="4"/></g>
     <g fill="#ffb703"><ellipse cx="307" cy="178" rx="9" ry="15"/><ellipse cx="367" cy="168" rx="9" ry="15"/><ellipse cx="433" cy="168" rx="9" ry="15"/><ellipse cx="493" cy="178" rx="9" ry="15"/></g>`,
  /** Football pitch with goal and ball. */
  football: () =>
    `<rect width="800" height="500" fill="#4caf50"/><g fill="#43a047"><rect y="0" width="800" height="60"/><rect y="120" width="800" height="60"/><rect y="240" width="800" height="60"/><rect y="360" width="800" height="60"/><rect y="480" width="800" height="20"/></g>
     <g fill="none" stroke="#fff" stroke-width="6"><rect x="250" y="40" width="300" height="140"/><path d="M250 40 l30 -25 h240 l30 25"/><circle cx="400" cy="560" r="160"/></g>
     <g stroke="#fff" stroke-width="2" opacity=".6"><path d="M265 50 v120 M295 50 v120 M325 50 v120 M355 50 v120 M385 50 v120 M415 50 v120 M445 50 v120 M475 50 v120 M505 50 v120 M535 50 v120"/></g>
     <circle cx="430" cy="330" r="46" fill="#fff" stroke="#222" stroke-width="4"/><polygon points="430,305 452,320 444,346 416,346 408,320" fill="#222"/>`,
  /** Instant "photo" of a family (simple silhouettes). */
  family: () =>
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ad0ec"/><stop offset="1" stop-color="#f7d9a8"/></linearGradient></defs>
     <rect width="800" height="500" fill="#f1e7d0"/><rect x="40" y="30" width="720" height="440" fill="url(#bg)"/><rect x="40" y="380" width="720" height="90" fill="#c9b18b"/>
     <circle cx="230" cy="190" r="42" fill="#7b4b2a"/><rect x="180" y="235" width="100" height="170" rx="40" fill="#2e86ab"/>
     <circle cx="350" cy="200" r="38" fill="#a0522d"/><rect x="305" y="240" width="90" height="160" rx="38" fill="#e76f51"/>
     <circle cx="460" cy="245" r="30" fill="#8b5a2b"/><rect x="425" y="278" width="70" height="125" rx="30" fill="#f4a261"/>
     <circle cx="560" cy="185" r="44" fill="#5c3d2e"/><rect x="508" y="232" width="104" height="175" rx="42" fill="#264653"/>
     <circle cx="650" cy="260" r="24" fill="#9c6644"/><rect x="622" y="286" width="56" height="115" rx="24" fill="#2a9d8f"/>`,
  /** A path with the yellow arrow of the Camino. */
  camino: () =>
    `<rect width="800" height="500" fill="#cfe8f5"/><circle cx="680" cy="80" r="40" fill="#fff3b0"/><path d="M0 260 q200 -60 400 -20 t400 -30 v290 h-800 z" fill="#a7c957"/>
     <path d="M330 500 q40 -120 90 -250 q10 -20 30 -20 q-20 0 -30 20 q-20 130 60 250 z" fill="#e9d8a6"/>
     <rect x="560" y="250" width="110" height="170" rx="10" fill="#9a8c7a"/><path d="M585 330 h55 l-18 -18 M640 330 l-18 18" stroke="#f9c80e" stroke-width="12" fill="none" stroke-linecap="round"/>
     <rect x="160" y="270" width="16" height="60" fill="#6b4f2c"/><g fill="#386641"><circle cx="140" cy="250" r="45"/><circle cx="190" cy="230" r="55"/></g>`,
});

/** Names of the available illustration scenes. */
export const ILLUSTRATION_SCENES = Object.freeze(Object.keys(SCENES));

/**
 * Illustration for the rich test letters, rendered from SVG, with an optional handwritten
 * caption under the picture (like a printed photo).
 * @param {string} scene  One of ILLUSTRATION_SCENES.
 * @param {{ caption?: string, format?: 'png' | 'jpeg', width?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export async function illustration(scene, { caption, format = 'jpeg', width = 800 } = {}) {
  const draw = SCENES[/** @type {keyof typeof SCENES} */ (scene)];
  if (!draw) throw new Error(`Unknown illustration scene "${scene}"`);
  const height = caption ? 560 : 500;
  const label = caption
    ? `<rect y="500" width="800" height="60" fill="#ffffff"/><text x="400" y="542" text-anchor="middle" font-family="'Segoe Script', 'Comic Sans MS', cursive" font-size="28" fill="#333">${xmlEscape(caption)}</text>`
    : '';
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}">${draw()}${label}</svg>`);
  const image = sharp(svg).resize({ width });
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 84 }).toBuffer();
}
