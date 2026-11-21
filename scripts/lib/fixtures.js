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
