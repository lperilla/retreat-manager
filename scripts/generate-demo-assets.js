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
import sharp from 'sharp';

import { buildDocx, buildPdf, fakeMov, letterSvg } from './lib/fixtures.js';

const OUT = fileURLToPath(new URL('../src/infrastructure/persistence/json/demo/assets/', import.meta.url));

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

const mov = fakeMov();
await writeFile(join(OUT, 'video-familia.mov'), mov);

for (const [name, data] of Object.entries({ 'carta-abuela.jpg': abuela, 'escaneo-raul.jpg': raul, 'perro.png': perro, 'video-familia.mov': mov })) {
  process.stdout.write(`${name}: ${data.length} bytes\n`);
}
process.stdout.write(`Demo assets written to ${OUT}\n`);
