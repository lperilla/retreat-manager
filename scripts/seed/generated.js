/**
 * Generated test letters for the participants that are ALREADY in the retreat
 * (`seed-gmail.js --generated`): about 100 letters of varied complexity (short and long plain
 * text, formatted HTML, illustrated letters with inline photos, PDF, Word, scans, photos,
 * replies, forwards, letters for two people and cases that must go to «Por revisar»).
 *
 * The letters are spread unevenly (some participants get many, some few, a couple none) so the
 * dashboard shows the differences. Greetings are gender-neutral ("Hola Lucía:", "Buenos días
 * Juan,") because the generator does not know who is who.
 *
 * Every letter is checked with the real recognition engine before it is returned: a letter
 * meant for someone that the engine would not assign to them is rewritten with the full name in
 * the subject, and dropped if it still fails; a «Por revisar» case that would be assigned is
 * dropped. So the expectations printed in the summary are always true.
 */
import { DOCX_MIME } from '../../src/domain/services/attachments.js';
import { createAttachmentMeta } from '../../src/domain/entities/Letter.js';
import { ContentAssignmentStrategy } from '../../src/domain/services/assignment.js';
import { computeFlags } from '../../src/domain/services/heuristics.js';
import { WARNING_FLAG_TYPES } from '../../src/domain/constants.js';
import { normalizeText } from '../../src/domain/services/text.js';
import { htmlToText } from '../../src/infrastructure/gmail/bodyExtractor.js';
import { toLettersParticipant } from '../../src/modules/participants/infrastructure/ParticipantDirectory.js';
import { buildDocx, buildPdf, illustration, ILLUSTRATION_SCENES, letterImage } from '../lib/fixtures.js';
import { SEED_SENDER_DOMAIN, THEMES, rich, styled } from './catalog.js';
import { formatAddress } from './mime.js';

/** Small deterministic random generator (same participants + seed → same letters). */
function random(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (/** @type {number} */ min, /** @type {number} */ max) => min + Math.floor(next() * (max - min + 1));
  const pick = (/** @type {readonly any[]} */ list) => list[Math.floor(next() * list.length)];
  const shuffle = (/** @type {readonly any[]} */ list) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const sample = (/** @type {readonly any[]} */ list, /** @type {number} */ n) => shuffle(list).slice(0, n);
  return { next, int, pick, shuffle, sample };
}

/** "LUIS EDUARDO" → "Luis Eduardo" (names typed in capitals are written normally in letters). */
const titleCase = (/** @type {string} */ value) =>
  value.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, letter) => `${sep}${letter.toUpperCase()}`);
const noAccents = (/** @type {string} */ value) => value.normalize('NFD').replace(/\p{M}+/gu, '');

const SENDERS = Object.freeze([
  ['Rosa', 'mamá'], ['Pilar', 'tu tía'], ['Jorge', 'papá'], ['Amaia', 'tu hermana'], ['Teresa', 'tu madrina'], ['Ricardo', 'tu hermano'],
  ['Elena', 'tu mujer'], ['Tomás', 'tu padrino'], ['Inés', 'tu prima'], ['Clara', 'tu hija'], ['Laura', 'tu hermana'], ['Rosario', 'tu cuñada'],
  ['Antonio', 'tu suegro'], ['Mercedes', 'tu abuela'], ['Íker', 'tu primo'], ['Valentina', 'tu sobrina'], ['Patricia', 'tu amiga'],
  ['Guadalupe', 'tu vecina'], ['Ramón', 'tu abuelo'], ['Gloria', 'tu madre'], ['Sofía', 'tu hija'], ['Paula', 'tu nieta'],
  ['Ernesto', 'tu compañero de trabajo'], ['Fernando', 'tu amigo de siempre'], ['Beatriz', 'tu catequista'], ['Raquel', 'tu hermana'],
  ['Alberto', 'tu cuñado'], ['Víctor', 'tu amigo'], ['Adrián', 'tu hijo'], ['Silvia', 'tu mujer'], ['Óscar', 'tu compañero de equipo'],
  ['Natalia', 'tu prima'], ['Gabriel', 'tu padrino'], ['Carolina', 'tu tía'], ['Lourdes', 'tu madre'], ['Emilio', 'tu tío'],
]);
const SENDER_SURNAMES = Object.freeze(['Martín', 'Sanz', 'Ríos', 'Castro', 'Rubio', 'Vega', 'Iglesias', 'Cano', 'Pascual', 'Lorenzo', 'Medina', 'Garrido', 'Cortés', 'Santos']);

const OPENERS = Object.freeze([
  'Te escribo desde la mesa de la cocina, con un café y muchas ganas de contarte cosas.',
  'No sabía muy bien cómo empezar esta carta, así que empiezo por lo más importante: te queremos muchísimo.',
  'Cuando nos dijeron que podíamos escribirte, no lo dudamos ni un segundo.',
  'Hoy he salido a caminar temprano y no he dejado de pensar en ti y en estos días que estás viviendo.',
  'Aquí estamos todos, cada uno con su papel, intentando poner en palabras lo que sentimos.',
  'Te mando estas líneas para que sepas que, aunque estemos lejos, estamos muy cerca.',
  'Me han dicho que estas cartas se leen en un momento especial, así que la he escrito despacio.',
  'Llevo toda la semana pensando qué ponerte y al final he decidido escribir lo que me salga del corazón.',
]);
const MIDDLES = Object.freeze([
  'En casa todo va bien. La caldera por fin funciona, el coche ha pasado la revisión y el perro sigue durmiendo en el sofá aunque se lo tengamos prohibido.',
  'Nos acordamos mucho del verano pasado en el pueblo: las cenas en la terraza, las partidas de mus que nunca terminaban y aquella tormenta que nos pilló volviendo del río.',
  'Sabemos que este año no ha sido fácil. Has tenido mucho trabajo, preocupaciones y noches sin dormir. Por eso nos alegra tanto que te regales estos días.',
  'Escucha mucho, habla cuando lo necesites y no tengas miedo de abrir el corazón. Lo que vivas allí será solo tuyo, y nadie te lo podrá quitar.',
  'Gracias por estar siempre: en los cumpleaños, en los hospitales, en las mudanzas y en las sobremesas largas. Eres de las personas que sostienen a los demás sin hacer ruido.',
  'A veces no te lo decimos lo suficiente, así que aprovecho que es por escrito: estamos muy orgullosos de ti y de todo lo que has construido.',
  'Los pequeños han preguntado cada noche cuándo vuelves. Les hemos dicho que estás descansando y haciendo amigos nuevos, y se han quedado muy conformes.',
  'Hemos encendido una vela en la parroquia y rezamos por ti cada noche. Que estos días te llenen de paz y de alegría.',
  'Me acuerdo de cuando éramos jóvenes y lo arreglábamos todo con una caminata y una conversación sin prisa. Ojalá allí encuentres muchas de esas.',
  'No te preocupes por nada de aquí. Las plantas están regadas, las facturas pagadas y la nevera, como siempre, más llena de lo necesario.',
  'Este año has demostrado que se puede empezar de nuevo. Has tenido paciencia, valentía y mucho sentido del humor, incluso en los peores días.',
  'Te echamos de menos en la mesa, sobre todo en la cena, cuando nadie cuenta los chistes malos que tanto nos hacen reír.',
  'Aprovecha para mirar hacia dentro, que el día a día no nos deja. A veces las respuestas llegan cuando por fin nos callamos un rato.',
  'Cuando vuelvas, te esperamos con tu comida favorita y con ganas de que nos lo cuentes todo despacio, con un café delante.',
  'La vida da muchas vueltas, pero hay cosas que no cambian: tu forma de cuidar a los demás y esa risa que se oye desde la otra punta de la casa.',
  'Hemos estado mirando fotos antiguas y no hemos parado de reír. Hay una en la playa, con aquel sombrero ridículo, que pienso enmarcar.',
  'Ojalá estos días te ayuden a soltar el peso que llevas encima. No tienes que tener todas las respuestas; basta con que estés.',
  'Aquí ha empezado a hacer frío de verdad. Las mañanas son de bufanda y las tardes de manta, y en todas te echamos en falta.',
]);
const CLOSINGS = Object.freeze([
  'Disfruta cada momento.',
  'Te esperamos con los brazos abiertos.',
  'Aprovecha, descansa y vuelve con las pilas cargadas.',
  'Que Dios te bendiga en estos días.',
  'Te queremos muchísimo ❤️',
  'Aquí estaremos cuando vuelvas.',
]);
const TOPICS = Object.freeze(['Desde casa', 'Unas líneas', 'Ánimo', 'Pensando en ti', 'Recuerdos', 'Un abrazo', 'Para el retiro', 'De parte de todos', 'Un saludo', 'Con cariño']);
const HEADINGS = Object.freeze(['Para ti, con todo el cariño', 'Una carta de las de antes', 'Lo que nunca te digo', 'Desde casa, con amor', 'Gracias por estar', 'Un camino compartido']);
const CAPTIONS = Object.freeze({
  sunset: 'Aquel atardecer en la sierra', sea: 'El mar del verano pasado', dog: 'Te espera en la puerta', crayon: 'Dibujo hecho en casa',
  cake: 'Te la guardamos', football: 'El partido del domingo', family: 'Todos juntos', camino: 'Solo el siguiente paso',
});

/** Splits text into lines of at most `width` characters (for PDF and scans). */
function wrap(/** @type {string} */ text, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && `${line} ${word}`.length > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}
const noEmoji = (/** @type {string} */ value) => value.replace(/[^\p{L}\p{N}\p{P}\p{Zs}\n]/gu, '').replace(/ +\n/g, '\n').trim();

/**
 * @param {ReadonlyArray<import('../../src/modules/participants/domain/ParticipantRecord.js').ParticipantRecord>} records
 * @param {{ count?: number, seed?: number }} [options]
 * @returns {Promise<import('./catalog.js').SeedLetter[]>}
 */
export async function generateLetters(records, { count = 100, seed = 20261122 } = {}) {
  const rnd = random(seed);
  const active = records.filter((r) => r.status === 'active');
  if (active.length < 3) throw new Error('Hacen falta al menos 3 participantes activos para generar cartas.');
  const participants = active.map(toLettersParticipant);
  const strategy = new ContentAssignmentStrategy();

  // How each participant can be named in a letter (each form is checked by the engine anyway).
  const firstWord = (/** @type {any} */ r) => titleCase(r.givenNames.split(' ')[0]);
  const firstCounts = new Map();
  for (const r of active) firstCounts.set(normalizeText(firstWord(r)), (firstCounts.get(normalizeText(firstWord(r))) ?? 0) + 1);
  const names = new Map(
    active.map((r) => {
      const full = r.nameNeedsReview ? titleCase(r.displayName) : `${firstWord(r)} ${titleCase(r.firstSurname)}`;
      const unique = firstCounts.get(normalizeText(firstWord(r))) === 1;
      return [r.id, { full, display: titleCase(r.displayName), short: unique ? firstWord(r) : full, alias: r.aliases[0] ?? null, surname: titleCase(r.firstSurname) }];
    }),
  );
  const taken = new Set(active.flatMap((r) => [normalizeText(firstWord(r)), ...r.aliases.map((a) => normalizeText(a))]));
  const senders = SENDERS.filter(([name]) => !taken.has(normalizeText(name)));

  // Uneven spread: a few participants get many letters, most get some, two get none.
  const order = rnd.shuffle(active.map((r) => r.id));
  const none = order.slice(-2);
  const receivers = order.slice(0, -2);
  const weights = receivers.map((_, i) => (i < 3 ? 10 - i * 1.5 : i < 8 ? 5 : i < 13 ? 2.5 : 1));
  const reviewCount = Math.max(8, Math.round(count * 0.1));
  const pairCount = Math.max(3, Math.round(count * 0.06));
  const singleCount = count - reviewCount - pairCount;
  const total = weights.reduce((a, b) => a + b, 0);
  /** @type {string[]} */
  const singles = [];
  receivers.forEach((id, i) => {
    for (let n = Math.max(1, Math.round((weights[i] / total) * singleCount)); n > 0; n -= 1) singles.push(id);
  });

  const when = () => /** @type {[number, string]} */ ([rnd.int(1, 6), `${String(rnd.int(7, 23)).padStart(2, '0')}:${String(rnd.int(0, 59)).padStart(2, '0')}`]);
  const sender = (/** @type {string} */ surname) => {
    const [name, role] = rnd.pick(senders);
    const familySurname = rnd.next() < 0.5 ? surname : rnd.pick(SENDER_SURNAMES);
    return { name, role, from: { name: `${name} ${familySurname}`, address: `${noAccents(`${name}.${familySurname}`).toLowerCase().replace(/[^a-z.]/g, '')}.${rnd.int(10, 99)}@${SEED_SENDER_DOMAIN}` } };
  };
  const greeting = (/** @type {{ short: string, alias: string | null }} */ n) => {
    const name = n.alias && rnd.next() < 0.35 ? n.alias : n.short;
    return rnd.pick([`Hola ${name}:`, `Hola, ${name}:`, `Buenos días ${name},`, `Buenas tardes, ${name}:`, `${name}:`]);
  };
  const subjectFor = (/** @type {{ full: string, short: string }} */ n) =>
    rnd.pick([`Carta para ${n.full}`, `Para ${n.short}`, `[Para: ${n.full}] ${rnd.pick(TOPICS)}`, rnd.pick(TOPICS), `Unas líneas para ${n.short}`, `CARTA PARA ${noAccents(n.full).toUpperCase()}`]);
  const body = (/** @type {number} */ paragraphs) => rnd.sample(MIDDLES, paragraphs);
  const signature = (/** @type {{ name: string, role: string }} */ s) => `${rnd.pick(['Un abrazo enorme', 'Con todo mi cariño', 'Te quiere', 'Muchos besos', 'Un fuerte abrazo'])},\n${s.name} (${s.role})`;

  /** Builders for one participant, from simple to complex. */
  const kinds = [
    { weight: 18, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      return { from: s.from, subject: subjectFor(n), text: [greeting(n), ...body(1), rnd.pick(CLOSINGS), signature(s)].join('\n\n'), tests: 'Texto plano corto' };
    } },
    { weight: 14, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      return { from: s.from, subject: subjectFor(n), text: [greeting(n), rnd.pick(OPENERS), ...body(rnd.int(4, 6)), rnd.pick(CLOSINGS), signature(s)].join('\n\n'), tests: 'Texto plano largo' };
    } },
    { weight: 20, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      const text = [greeting(n), rnd.pick(OPENERS), ...body(rnd.int(2, 4)), rnd.pick(CLOSINGS), signature(s)].join('\n\n');
      const theme = /** @type {keyof typeof THEMES} */ (rnd.pick(Object.keys(THEMES)));
      return { from: s.from, subject: subjectFor(n), ...styled(text, theme), tests: `Texto + HTML con formato (${theme})` };
    } },
    { weight: 14, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      const { font, color, accent } = THEMES[/** @type {keyof typeof THEMES} */ (rnd.pick(Object.keys(THEMES)))];
      const scenes = rnd.sample(ILLUSTRATION_SCENES, rnd.int(1, 2));
      const tag = `g${rnd.int(1000, 9999)}`;
      const images = scenes.map((scene, i) => ({ id: `${tag}-${scene}-${i}`, scene }));
      const paragraphs = body(rnd.int(3, 4)).map((p) => `<p style="text-align:justify">${p}</p>`);
      const pictures = images.map((image) => `<p style="text-align:center"><img src="cid:${image.id}@${SEED_SENDER_DOMAIN}" alt="${CAPTIONS[/** @type {keyof typeof CAPTIONS} */ (image.scene)]}"></p>`);
      const extra = rnd.pick([
        `<blockquote style="color:${accent};font-style:italic;text-align:center;background-color:#fdf3e7">«${rnd.pick(CLOSINGS)}»</blockquote>`,
        `<ul><li style="color:${accent}">Descansa</li><li>Escucha</li><li style="color:${accent}">Disfruta</li></ul>`,
        `<table><tr><td style="color:${accent}"><b>Lo que te esperamos</b></td><td>con muchas ganas</td></tr><tr><td style="color:${accent}"><b>Lo que te deseamos</b></td><td>paz y alegría</td></tr></table>`,
      ]);
      const html = `<div style="font-family:${font};color:${color};font-size:16px;line-height:1.7"><h2 style="color:${accent};text-align:center">${rnd.pick(HEADINGS)}</h2><p style="color:${accent};font-size:19px"><b>${greeting(n)}</b></p>${paragraphs[0]}${pictures[0]}${paragraphs.slice(1).join('')}${extra}${pictures[1] ?? ''}<hr><p style="color:${accent};font-style:italic;text-align:right">${signature(s).replace('\n', '<br>')}</p></div>`;
      return {
        from: s.from, subject: `Carta para ${n.full}`, ...rich(html), tests: `Carta ilustrada con ${images.length} foto(s) incrustada(s)`,
        attachments: async () => Promise.all(images.map(async (image) => ({ filename: `${image.scene}.jpg`, mimeType: 'image/jpeg', data: await illustration(image.scene, { caption: CAPTIONS[/** @type {keyof typeof CAPTIONS} */ (image.scene)] }), contentId: `${image.id}@${SEED_SENDER_DOMAIN}` }))),
      };
    } },
    { weight: 6, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      const letter = noEmoji([greeting(n), ...body(3), rnd.pick(CLOSINGS), signature(s)].join('\n\n'));
      return { from: s.from, subject: `Carta para ${n.full}`, text: `${greeting(n)}\n\nTe mando la carta en PDF, que la he escrito con calma.\n\n${s.name}`, tests: 'Carta en PDF adjunto',
        attachments: async () => [{ filename: `Carta para ${n.short}.pdf`, mimeType: 'application/pdf', data: buildPdf(wrap(letter, 85)) }] };
    } },
    { weight: 6, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      const letter = [greeting(n), '', ...body(3).flatMap((p) => [p, '']), signature(s)].join('\n');
      return { from: s.from, subject: `Carta para ${n.full}`, text: 'Va en el documento de Word adjunto.', tests: 'Carta en Word (.docx)',
        attachments: async () => [{ filename: `carta-${noAccents(n.short).toLowerCase().replace(/\s+/g, '-')}.docx`, mimeType: DOCX_MIME, data: buildDocx(letter.split('\n')) }] };
    } },
    { weight: 6, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      const lines = wrap(noEmoji([greeting(n), rnd.pick(MIDDLES), rnd.pick(CLOSINGS), s.name].join('\n\n')), 40).slice(0, 18);
      return { from: s.from, subject: subjectFor(n), text: `${greeting(n)}\n\nTe mando escaneada la carta escrita a mano.\n\n${s.name}`, tests: 'Carta escaneada (JPEG con EXIF)',
        attachments: async () => [{ filename: `IMG_${rnd.int(1000, 9999)}.jpg`, mimeType: 'image/jpeg', data: await letterImage(lines, { rotateExif: rnd.next() < 0.5 }) }] };
    } },
    { weight: 6, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      const scene = rnd.pick(ILLUSTRATION_SCENES);
      return { from: s.from, subject: subjectFor(n), ...styled([greeting(n), 'Te mando una foto para que nos tengas cerca estos días.', rnd.pick(MIDDLES), signature(s)].join('\n\n'), 'modern'), tests: 'Foto adjunta (PNG)',
        attachments: async () => [{ filename: `foto-${scene}.png`, mimeType: 'image/png', data: await illustration(scene, { caption: CAPTIONS[/** @type {keyof typeof CAPTIONS} */ (scene)], format: 'png' }) }] };
    } },
    { weight: 4, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      return { from: s.from, subject: `🌟 Para ${n.short} 🌟`, text: [`¡¡${n.alias ?? n.short}!! 🥳`, 'Te echamos muchísimo de menos 😭 El perro está triste 🐶 y en casa no paramos de mirar tus fotos 📸', 'Cuando vuelvas, maratón de pelis 🍿🎬', `Te queremos 💖✨\n${s.name}`].join('\n\n'), tests: 'Asunto y cuerpo con emojis' };
    } },
    { weight: 4, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      return { from: s.from, subject: `Carta para ${n.full}`, textCharset: 'iso-8859-1', text: [greeting(n), ...body(2), signature(s)].join('\n\n'), tests: 'Texto en ISO-8859-1' };
    } },
    { weight: 4, build: async (/** @type {any} */ n, /** @type {any} */ other) => {
      const s = sender(n.surname);
      return { from: s.from, subject: 'Re: Cartas para el retiro', text: `${[greeting(n), ...body(2), signature(s)].join('\n\n')}\n\nEl lun, 16 nov 2026 a las 21:04, Coordinación Retiro <coordinacion@${SEED_SENDER_DOMAIN}> escribió:\n> Queridas familias:\n> Recordad que el plazo para escribir a ${other.full} y al resto del grupo termina el jueves.\n> Un saludo`, tests: 'Respuesta que cita un correo que nombra a otra persona (la cita se ignora)' };
    } },
    { weight: 3, build: async (/** @type {any} */ n) => {
      const s = sender(n.surname);
      return { from: s.from, subject: 'Fwd: una carta para ti', text: `Te reenvío la carta de la abuela, que no sabe usar el correo del retiro.\n\n---------- Forwarded message ---------\nDe: Abuela <abuela.${rnd.int(10, 99)}@${SEED_SENDER_DOMAIN}>\nSubject: Para ${n.short}\n\n${[greeting(n), rnd.pick(MIDDLES), 'Tu abuela'].join('\n\n')}`, tests: 'Carta reenviada' };
    } },
  ];
  const pickKind = () => {
    const sum = kinds.reduce((a, k) => a + k.weight, 0);
    let r = rnd.next() * sum;
    for (const kind of kinds) if ((r -= kind.weight) < 0) return kind;
    return kinds[0];
  };

  /**
   * @param {Record<string, any>} draft
   * @returns {Promise<{ status: string, participantIds: string[], flags: string[] }>}
   */
  const evaluate = async (draft) => {
    const attachments = draft.attachments ? await draft.attachments() : [];
    const text = draft.text?.trim() ? draft.text : draft.html ? htmlToText(draft.html) : draft.text ?? '';
    const from = formatAddress(draft.from);
    const assignment = strategy.assign({ subject: draft.subject, body: text, from }, participants);
    const metas = attachments.map((a) => createAttachmentMeta({ filename: a.filename, mimeType: a.mimeType, size: a.data.length, contentId: a.contentId }));
    const flags = computeFlags({ subject: draft.subject, body: text, from, headers: draft.headers ?? {}, attachments: metas, participantIds: assignment.participantIds }).map((f) => f.type);
    return { status: assignment.status, participantIds: [...assignment.participantIds].sort(), suggestions: assignment.suggestedParticipantIds, flags };
  };

  /** @type {import('./catalog.js').SeedLetter[]} */
  const letters = [];
  const add = (/** @type {Record<string, any>} */ draft, /** @type {any} */ expect) => {
    const id = `gen-${String(letters.length + 1).padStart(3, '0')}`;
    letters.push(/** @type {any} */ ({ id, when: when(), ...draft, expect }));
  };
  const warnings = (/** @type {string[]} */ flags) => flags.filter((f) => WARNING_FLAG_TYPES.includes(f));

  /** Keeps a letter only when the engine assigns it to exactly `ids` (rewriting the subject once if needed). */
  const addAssigned = async (/** @type {Record<string, any>} */ draft, /** @type {string[]} */ ids, /** @type {string} */ fallbackSubject) => {
    const target = [...ids].sort().join(',');
    for (const attempt of [draft, { ...draft, subject: fallbackSubject }]) {
      const result = await evaluate(attempt);
      if (result.status === 'ASSIGNED' && result.participantIds.join(',') === target && warnings(result.flags).length === 0) {
        add(attempt, { status: 'ASSIGNED', participants: [...ids], ...(ids.length > 1 ? { flags: ['MULTI_RECIPIENT'] } : {}) });
        return true;
      }
    }
    return false;
  };

  for (const id of rnd.shuffle(singles)) {
    const n = /** @type {any} */ (names.get(id));
    const other = names.get(rnd.pick(active.filter((r) => r.id !== id)).id);
    await addAssigned(await pickKind().build(n, other), [id], `Carta para ${n.display}`);
  }

  for (let i = 0; i < pairCount; i += 1) {
    const [a, b] = rnd.sample(receivers, 2);
    const na = /** @type {any} */ (names.get(a));
    const nb = /** @type {any} */ (names.get(b));
    const s = sender(rnd.pick([na.surname, nb.surname]));
    const draft = rnd.next() < 0.5
      ? { from: s.from, subject: `Carta para ${na.full} y ${nb.full}`, ...styled(['Hola a los dos:', 'Qué alegría saber que coincidís en el retiro. Cuidaos el uno al otro y aprovechad para conoceros más.', ...body(2), signature(s)].join('\n\n'), 'warm'), tests: 'Carta para dos participantes (en el asunto)' }
      : { from: s.from, subject: 'Para los dos', text: [`Hola ${na.short} y ${nb.short}:`, 'Nos ha hecho mucha ilusión saber que estáis juntos estos días.', ...body(2), signature(s)].join('\n\n'), tests: 'Carta para dos participantes (en el saludo)' };
    await addAssigned(draft, [a, b], `Carta para ${na.display} y ${nb.display}`);
  }

  // «Por revisar» cases: kept only when the engine really sends them to review.
  const shared = [...firstCounts].find(([, n]) => n > 1)?.[0];
  const sharedName = shared ? firstWord(active.find((r) => normalizeText(firstWord(r)) === shared)) : null;
  const mentioned = /** @type {any} */ (names.get(none[0]));
  const s = () => sender(rnd.pick(SENDER_SURNAMES));
  const reviewDrafts = [
    sharedName && { draft: { from: s().from, subject: 'Unas líneas para ti', text: `Hola ${sharedName}:\n\n${body(2).join('\n\n')}\n\nUn abrazo`, tests: `Nombre de pila compartido («Hola ${sharedName}:») → Por revisar` } },
    sharedName && { draft: { from: s().from, subject: `Ánimo, ${sharedName}`, text: `${body(1)[0]}\n\nUn beso`, tests: `Nombre compartido en el asunto («Ánimo, ${sharedName}») → Por revisar` } },
    { draft: { from: { name: 'Parroquia San Miguel', address: `boletin.${rnd.int(10, 99)}@${SEED_SENDER_DOMAIN}` }, subject: 'Boletín semanal', headers: { 'List-Unsubscribe': `<mailto:baja@${SEED_SENDER_DOMAIN}>`, Precedence: 'bulk' }, html: '<h1 style="color:#264653">Boletín semanal</h1><p>Esta semana celebramos el retiro. Os pedimos oraciones por los participantes y por el equipo.</p>', tests: 'Boletín masivo → aviso «Envío masivo»' }, flag: 'NEWSLETTER_OR_BULK' },
    { draft: { from: s().from, subject: '', text: '\n\nEnviado desde mi iPhone', tests: 'Solo «Enviado desde mi iPhone» → aviso «Solo firma»' }, flag: 'SIGNATURE_ONLY' },
    { draft: { from: s().from, subject: 'Escaneo', text: '', tests: 'Solo un escaneo, sin texto → «Solo adjuntos»', attachments: async () => [{ filename: 'escaneo.jpg', mimeType: 'image/jpeg', data: await letterImage([`Para ${mentioned.short}:`, '', 'Te escribimos a mano', 'para que sepas que te queremos.'], { rotateExif: true }) }] }, flag: 'ATTACHMENT_ONLY' },
    { draft: { from: s().from, subject: 'Ánimo', text: `Hola Andrés:\n\n${body(2).join('\n\n')}\n\nUn abrazo de toda la familia.`, tests: 'Saludo a alguien que no está en la lista → Por revisar' } },
    { draft: { from: s().from, subject: 'Para Rocío', text: `${body(2).join('\n\n')}\n\nTu tía`, tests: 'Asunto con un nombre que no es de ningún participante → Por revisar' } },
    { draft: { from: { name: 'Grupo de oración', address: `oracion.${rnd.int(10, 99)}@${SEED_SENDER_DOMAIN}` }, subject: 'Pensando en vosotros', text: `Esta semana el grupo de oración ha rezado mucho por ${mentioned.full} y por todo su grupo del retiro. Os mandamos mucha fuerza.\n\nUn saludo cariñoso.`, tests: `Solo se menciona a ${mentioned.full}, sin saludo → Por revisar con sugerencia` } },
    { draft: { from: s().from, subject: 'Recuerdos de casa', text: `${body(5).join(' ')}\n\nHola ${mentioned.short}:\n\nTe esperamos.\n\nTu familia`, tests: 'Saludo después de un párrafo muy largo → Por revisar' } },
    { draft: { from: { name: 'Mail Delivery Subsystem', address: `mailer-daemon@${SEED_SENDER_DOMAIN}` }, subject: 'Delivery Status Notification (Failure)', text: 'No se ha podido entregar el mensaje porque la dirección no existe.\n\n550 5.1.1 The email account that you tried to reach does not exist.', tests: 'Error de entrega (mailer-daemon)' }, flag: 'MAILER_DAEMON' },
  ].filter(Boolean);
  for (const item of /** @type {any[]} */ (reviewDrafts).slice(0, reviewCount)) {
    const result = await evaluate(item.draft);
    if (result.status !== 'NEEDS_REVIEW') continue;
    if (item.flag && !result.flags.includes(item.flag)) continue;
    add(item.draft, { status: 'NEEDS_REVIEW', ...(item.flag ? { flags: [item.flag] } : {}) });
  }

  letters.sort((a, b) => b.when[0] - a.when[0] || a.when[1].localeCompare(b.when[1]));
  return letters;
}
