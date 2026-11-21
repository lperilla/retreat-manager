/**
 * Regenerates the demo attachment files in src/infrastructure/persistence/json/demo/assets/
 * (fictitious content). The generated files are committed; run this only to change them:
 *
 *   node scripts/generate-demo-assets.js
 *
 * - carta-abuela.jpg  scanned handwritten letter, stored rotated with EXIF Orientation=6
 *                     (tests the automatic rotation)
 * - escaneo-raul.jpg  attachment-only scan ("Querido Raúl: …")
 * - carta-para-elena.pdf, carta-diego.docx, perro.png (inline cid image), video-familia.mov
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

import sharp from 'sharp';

const OUT = fileURLToPath(new URL('../src/infrastructure/persistence/json/demo/assets/', import.meta.url));

/** @param {string} text */
const xml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Paper-like letter rendered from SVG.
 * @param {string[]} lines
 * @param {{ width?: number, height?: number }} [size]
 */
function letterSvg(lines, { width = 1240, height = 1600 } = {}) {
  const text = lines
    .map((line, i) => `<text x="110" y="${190 + i * 70}" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="46" fill="#1d2a6b">${xml(line)}</text>`)
    .join('');
  const rules = Array.from({ length: 19 }, (_, i) => `<line x1="80" x2="${width - 80}" y1="${205 + i * 70}" y2="${205 + i * 70}" stroke="#c9d6ea" stroke-width="2"/>`).join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fbf6e9"/><line x1="70" x2="70" y1="0" y2="${height}" stroke="#e7a9a9" stroke-width="3"/>${rules}${text}</svg>`,
  );
}

/** Minimal single-page PDF (Helvetica, WinAnsi) with correct xref offsets. */
function buildPdf(/** @type {string[]} */ lines) {
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

/** Store-only ZIP writer (enough for a minimal .docx). */
function buildZip(/** @type {Array<{ name: string, data: string }>} */ entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data, 'utf8');
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

function buildDocx(/** @type {string[]} */ paragraphs) {
  const body = paragraphs
    .map((p) => (p ? `<w:p><w:r><w:t xml:space="preserve">${xml(p)}</w:t></w:r></w:p>` : '<w:p/>'))
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

await mkdir(OUT, { recursive: true });

const abuela = await sharp(
  letterSvg([
    'Querido Javi:',
    '',
    'Tu madre me ha dicho que estás de retiro y no',
    'he querido dejar pasar la ocasión de escribirte,',
    'aunque sea con mi letra de siempre.',
    '',
    'Me acuerdo mucho de cuando venías a casa',
    'a merendar pan con chocolate. Has crecido',
    'tanto que a veces no me lo creo.',
    '',
    'Aprovecha estos días, escucha y reza.',
    'Aquí te espero con un abrazo muy fuerte.',
    '',
    'Tu abuela Maruja',
  ]),
)
  .rotate(-90)
  .jpeg({ quality: 82 })
  .withMetadata({ orientation: 6 })
  .toBuffer();
await writeFile(join(OUT, 'carta-abuela.jpg'), abuela);

const raul = await sharp(
  letterSvg([
    'Querido Raúl:',
    '',
    'Como no sabíamos escribir en el ordenador,',
    'te mandamos la carta escaneada.',
    '',
    'Estamos muy contentos de que hayas ido.',
    'Tus hermanos preguntan por ti cada día',
    'y el perro te busca por toda la casa.',
    '',
    'Te queremos muchísimo.',
    '',
    'Papá, mamá, Sara y Hugo',
  ]),
)
  .jpeg({ quality: 82 })
  .toBuffer();
await writeFile(join(OUT, 'escaneo-raul.jpg'), raul);

await writeFile(
  join(OUT, 'carta-para-elena.pdf'),
  buildPdf([
    'Querida Elena:',
    '',
    'Te escribimos esta carta con calma, en el ordenador, para que te llegue',
    'bien bonita. Este verano fue precioso: la playa, las bicis, las noches',
    'de estrellas en casa de los abuelos.',
    '',
    'Estamos muy orgullosos de la persona en la que te estás convirtiendo.',
    'Disfruta del retiro y vuelve con muchas cosas que contarnos.',
    '',
    'Te queremos mucho.',
    '',
    'Papá y mamá',
  ]),
);

await writeFile(
  join(OUT, 'carta-diego.docx'),
  buildDocx([
    'Querido Diego:',
    '',
    'Llevo varios días escribiendo esta carta a ratos, entre clase y clase.',
    'Quería decirte que eres el mejor hermano que podría tener, aunque a veces',
    'nos peleemos por el mando de la tele.',
    '',
    'Disfruta muchísimo del retiro. Cuando vuelvas te tengo preparada una sorpresa.',
    '',
    'Un abrazo enorme,',
    'Begoña',
  ]),
);

const perro = await sharp({ create: { width: 360, height: 240, channels: 3, background: '#d9c5a3' } })
  .composite([
    {
      input: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><circle cx="180" cy="120" r="70" fill="#8b5a2b"/><circle cx="150" cy="105" r="10" fill="#222"/><circle cx="210" cy="105" r="10" fill="#222"/><ellipse cx="180" cy="140" rx="18" ry="12" fill="#222"/><ellipse cx="120" cy="80" rx="22" ry="40" fill="#5c3a1a"/><ellipse cx="240" cy="80" rx="22" ry="40" fill="#5c3a1a"/><text x="180" y="225" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#333">Toby te echa de menos</text></svg>',
      ),
    },
  ])
  .png()
  .toBuffer();
await writeFile(join(OUT, 'perro.png'), perro);

const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  \x00\x00\x02\x00qt  ', 'latin1'), Buffer.alloc(2048, 0)]);
await writeFile(join(OUT, 'video-familia.mov'), mov);

for (const [name, data] of Object.entries({ 'carta-abuela.jpg': abuela, 'escaneo-raul.jpg': raul, 'perro.png': perro, 'video-familia.mov': mov })) {
  process.stdout.write(`${name}: ${data.length} bytes\n`);
}
process.stdout.write(`Demo assets written to ${OUT}\n`);
