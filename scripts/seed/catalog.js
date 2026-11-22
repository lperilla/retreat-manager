/**
 * Test-letter catalog for `npm run seed:gmail`: fictitious participants of a men's retreat and
 * ~60 letters in many formats (plain text, formatted HTML with fonts, colours and illustrations,
 * multipart, Latin-1, emojis, scans, photos, PDF, DOCX, inline cid images, unsupported and
 * blocked files, replies, forwards, auto-replies, newsletters, bounces…). Every letter documents
 * what it tests and the expected result, which test/project/seedCatalog.test.js checks against
 * the real pipeline.
 *
 * Every sender uses the fictitious domain SEED_SENDER_DOMAIN, so the letters can be selected
 * (GMAIL_QUERY=from:familias-prueba.example) and deleted from Gmail with one search.
 *
 * Writing rule: a letter never names another participant (outside the deliberate tests), so the
 * recognition results stay exactly as documented.
 */
import { DOCX_MIME } from '../../src/domain/services/attachments.js';
import { toZonedDateKey, zonedWallClockToInstant } from '../../src/domain/services/time.js';
import { htmlToText } from '../../src/infrastructure/gmail/bodyExtractor.js';
import { buildDocx, buildPdf, buildZip, drawing, fakeHeic, fakeMov, illustration, letterImage } from '../lib/fixtures.js';

export const SEED_SENDER_DOMAIN = 'familias-prueba.example';
export const SEED_QUERY = `from:${SEED_SENDER_DOMAIN}`;
const TIME_ZONE = 'Europe/Madrid';

/**
 * @typedef {Object} SeedParticipant
 * @property {string} displayName   Given names + first surname (what the letters use).
 * @property {string[]} aliases
 * @property {Record<string, any>} profile  Full record data for --load-participants.
 */

const confirmed = true;

/**
 * @param {string} givenNames
 * @param {string} firstSurname
 * @param {string[]} aliases
 * @param {Record<string, any>} profile
 * @returns {SeedParticipant}
 */
function person(givenNames, firstSurname, aliases, profile) {
  return Object.freeze({ displayName: `${givenNames} ${firstSurname}`, aliases, profile: Object.freeze({ givenNames, firstSurname, aliases, ...profile }) });
}

/**
 * Participants matching the letters: adult men of different ages and nationalities. The
 * profile (age, nationality, emergency contact, diet, accessibility…) is loaded into the
 * database with --load-participants; --write-participants only writes names and aliases.
 * @type {readonly SeedParticipant[]}
 */
export const SEED_PARTICIPANTS = Object.freeze([
  person('Manuel', 'García', ['Manolo'], {
    birthDate: '1972-03-14', nationality: 'España', phone: '+34 611 204 318', snores: 'yes', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Rosa Martín', relationship: 'Esposa', phone: '+34 611 204 319' }],
  }),
  person('Manuel', 'López', [], {
    birthDate: '1958-11-02', nationality: 'México', phone: '+34 622 418 907', snores: 'no', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Guadalupe Ortiz', relationship: 'Esposa', phone: '+34 622 418 900' }],
    dietary: [{ type: 'diet', code: 'diabetic' }],
    notes: 'Necesita tomar la medicación con el desayuno y la cena.',
  }),
  person('Juan', 'Martínez', ['Juanito'], {
    birthDate: '1957-06-21', nationality: 'España', phone: '+34 633 120 455', snores: 'yes', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Ramón Martínez', relationship: 'Padre', phone: '+34 633 120 400' }, { name: 'Lourdes Peña', relationship: 'Esposa', phone: '+34 633 120 401' }],
    accessibilityNeeds: [{ code: 'avoid_stairs' }, { code: 'transport_help', detail: 'Para la salida al monte del sábado' }],
    supports: 'Acompañarle en los desplazamientos largos.',
  }),
  person('Francisco José', 'Torres', ['Curro'], {
    age: 41, nationality: 'España', phone: '+34 644 902 117', snores: 'unknown', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Rocío Torres', relationship: 'Esposa', phone: '+34 644 902 118' }],
  }),
  person('Álvaro', 'Herrera', [], {
    birthDate: '1996-09-30', nationality: 'España', phone: '+34 655 731 042', snores: 'no', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Antonio Herrera', relationship: 'Padre', phone: '+34 655 731 040' }],
    dietary: [{ type: 'allergy', code: 'crustaceans', severity: 'mild' }],
  }),
  person('Lucas', 'Fernández', [], {
    birthDate: '1979-01-08', nationality: 'Argentina', phone: '+34 666 245 873', snores: 'yes', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Elena Ríos', relationship: 'Esposa', phone: '+34 666 245 870' }],
  }),
  person('Pablo', 'Ortega', [], {
    birthDate: '1965-04-17', nationality: 'España', phone: '+34 677 508 214', snores: 'no', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Carmen Ruiz', relationship: 'Esposa', phone: '+34 677 508 210' }],
    accessibilityNeeds: [{ code: 'reduced_mobility', detail: 'Operado de rodilla en verano' }],
    supports: 'Silla con reposabrazos en las charlas.',
  }),
  person('Pablo', 'Ruiz', [], {
    birthDate: '1988-12-05', nationality: 'Colombia', phone: '+34 688 314 096', snores: 'no', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Valentina Ruiz', relationship: 'Esposa', phone: '+34 688 314 090' }],
    dietary: [{ type: 'diet', code: 'gluten_free', detail: 'Celíaco' }],
  }),
  person('Carlos', 'Delgado', [], {
    birthDate: '1983-07-23', nationality: 'Perú', phone: '+34 699 862 530', snores: 'unknown', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Patricia Salas', relationship: 'Esposa', phone: '+34 699 862 531' }],
    dietary: [{ type: 'allergy', code: 'nuts', severity: 'severe', detail: 'Lleva autoinyector de adrenalina' }],
  }),
  person('Javier', 'Moreno', ['Javi'], {
    birthDate: '1975-02-11', nationality: 'España', phone: '+34 610 447 285', snores: 'yes', attendanceConfirmed: false,
    emergencyContacts: [{ name: 'Inés Moreno', relationship: 'Esposa', phone: '+34 610 447 280' }],
  }),
  person('Iván', 'Vázquez', [], {
    birthDate: '1990-10-19', nationality: 'Venezuela', phone: '+34 621 093 664', snores: 'no', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Jorge Vázquez', relationship: 'Padre', phone: '+34 621 093 660' }],
  }),
  person('Diego', 'Navarro', [], {
    birthDate: '1993-05-02', nationality: 'España', phone: '+34 632 570 118', snores: 'no', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Begoña Navarro', relationship: 'Hermana', phone: '+34 632 570 110' }],
  }),
  person('Nicolás', 'Prieto', [], {
    birthDate: '1986-08-27', nationality: 'Ecuador', phone: '+34 643 218 559', snores: 'yes', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Andrea Prieto', relationship: 'Esposa', phone: '+34 643 218 550' }],
    dietary: [{ type: 'diet', code: 'vegetarian' }],
  }),
  person('Sergio', 'Romero', [], {
    birthDate: '1969-12-30', nationality: 'España', phone: '+34 654 381 902', snores: 'no', attendanceConfirmed: false,
    emergencyContacts: [{ name: 'Luis Romero', relationship: 'Padre', phone: '+34 654 381 900' }],
    accessibilityNeeds: [{ code: 'hearing_support', detail: 'Mejor sentarle en las primeras filas' }],
  }),
  person('Mario', 'Gil', [], {
    birthDate: '1998-03-09', nationality: 'España', phone: '+34 665 207 431', snores: 'no', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Puri Gil', relationship: 'Tía', phone: '+34 665 207 430' }],
  }),
  person('Hugo', 'Serrano', [], {
    birthDate: '1981-11-15', nationality: 'España', phone: '+34 676 912 304', snores: 'yes', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Begoña Serrano', relationship: 'Esposa', phone: '+34 676 912 300' }],
    dietary: [{ type: 'intolerance', code: 'lactose' }],
  }),
  person('Claudio', 'Molina', [], {
    age: 52, nationality: 'Colombia', phone: '+34 687 134 670', snores: 'unknown', attendanceConfirmed: false,
    emergencyContacts: [{ name: 'Marcela Molina', relationship: 'Hermana', phone: '+34 687 134 671' }],
  }),
  person('José Ignacio', 'Sanz', ['Nacho'], {
    birthDate: '1977-04-04', nationality: 'España', phone: '+34 698 450 213', snores: 'no', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Lucía Sanz', relationship: 'Esposa', phone: '+34 698 450 210' }],
  }),
  person('Borja', 'Ibáñez', [], {
    birthDate: '1991-06-12', nationality: 'España', phone: '+34 609 382 775', snores: 'no', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Amaia Ibáñez', relationship: 'Hermana', phone: '+34 609 382 770' }],
  }),
  person('Íñigo', 'Ezquerra', [], {
    birthDate: '1984-01-26', nationality: 'España', phone: '+34 618 925 340', snores: 'yes', attendanceConfirmed: confirmed,
    emergencyContacts: [{ name: 'Ane Ezquerra', relationship: 'Esposa', phone: '+34 618 925 341' }],
    notes: 'Llega el viernes por la noche, después del trabajo.',
  }),
]);

/**
 * @param {string} name
 * @param {string} local
 */
const from = (name, local) => ({ name, address: `${local}@${SEED_SENDER_DOMAIN}` });

/** Joins paragraphs with a blank line. */
const para = (/** @type {string[]} */ ...paragraphs) => paragraphs.join('\n\n');

/** @param {string} text */
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Looks of the formatted letters (what Gmail, Outlook or Apple Mail send next to the text). */
export const THEMES = Object.freeze({
  classic: { font: "Georgia, 'Times New Roman', serif", color: '#2b2b2b', accent: '#1d3557', size: '16px' },
  warm: { font: "'Palatino Linotype', 'Book Antiqua', Palatino, serif", color: '#3a2e2a', accent: '#9c2c2c', size: '16px' },
  modern: { font: "'Trebuchet MS', Arial, sans-serif", color: '#1f2933', accent: '#0b7285', size: '15px' },
  hand: { font: "'Segoe Script', 'Comic Sans MS', cursive", color: '#283593', accent: '#283593', size: '17px' },
  kids: { font: "'Comic Sans MS', 'Chalkboard SE', cursive", color: '#333333', accent: '#d6336c', size: '17px' },
  mono: { font: "'Courier New', Courier, monospace", color: '#222222', accent: '#000000', size: '15px' },
  office: { font: "Calibri, 'Segoe UI', Arial, sans-serif", color: '#1f1f1f', accent: '#2f5496', size: '15px' },
});

/**
 * Plain-text letter plus its formatted HTML version (multipart/alternative): the greeting in the
 * accent colour and bold, the signature in italics, the theme's font and colours.
 * @param {string} text
 * @param {keyof typeof THEMES} theme
 * @returns {{ text: string, html: string }}
 */
export function styled(text, theme) {
  const { font, color, accent, size } = THEMES[theme];
  const paragraphs = text.split('\n\n');
  const body = paragraphs
    .map((paragraph, index) => {
      const content = paragraph.split('\n').map(escapeHtml).join('<br>');
      if (index === 0 && paragraph.length <= 80) return `<p style="color:${accent};font-weight:bold;font-size:18px">${content}</p>`;
      if (index === paragraphs.length - 1 && paragraph.length <= 120) return `<p style="color:${accent};font-style:italic">${content}</p>`;
      return `<p style="text-align:justify">${content}</p>`;
    })
    .join('');
  return { text, html: `<div style="font-family:${font};color:${color};font-size:${size};line-height:1.6">${body}</div>` };
}

/**
 * Hand-written HTML letter with its text version, as mail clients send it.
 * @param {string} html
 * @returns {{ text: string, html: string }}
 */
export function rich(html) {
  return { text: htmlToText(html), html };
}

/**
 * Inline illustration referenced as cid:<id> from the HTML.
 * @param {string} id
 * @param {string} scene
 * @param {string} [caption]
 */
async function inlineImage(id, scene, caption) {
  return { filename: `${id}.jpg`, mimeType: 'image/jpeg', data: await illustration(scene, { caption }), contentId: `${id}@${SEED_SENDER_DOMAIN}` };
}

/**
 * @param {string} id
 * @param {string} alt
 */
const img = (id, alt) => `<img src="cid:${id}@${SEED_SENDER_DOMAIN}" alt="${escapeHtml(alt)}">`;

/**
 * @typedef {Object} SeedExpectation
 * @property {'ASSIGNED' | 'NEEDS_REVIEW'} status
 * @property {string[]} [participants]  Participant ids (slugs) when ASSIGNED.
 * @property {string[]} [suggestions]   Leading suggestions when NEEDS_REVIEW ([] = none).
 * @property {string[]} [flags]         Flags that must be present.
 */

/**
 * @typedef {Object} SeedLetter
 * @property {string} id
 * @property {string} tests             What the letter exercises (Spanish, for the summary).
 * @property {{ name?: string, address: string }} from
 * @property {string} subject
 * @property {string} [text]
 * @property {string} [textCharset]
 * @property {string} [html]
 * @property {Record<string, string>} [headers]
 * @property {() => Promise<import('./mime.js').MimeAttachment[]>} [attachments]
 * @property {[number, string]} when     [days before today, 'HH:MM'] in Europe/Madrid.
 * @property {SeedExpectation} expect
 */

const LONG_INTRO =
  'Esta tarde hemos estado ordenando el altillo del piso y hemos encontrado una caja de zapatos llena de fotos de cuando eras pequeño. Salías en todas con las rodillas peladas, con aquella camiseta de rayas que no había forma de quitarte y con la bici roja sin frenos que te regaló el vecino del cuarto. Nos hemos reído muchísimo recordando el verano en el pueblo en que te empeñaste en construir una cabaña en la higuera y acabamos todos merendando allí arriba, y también nos hemos emocionado un poco, para qué te vamos a engañar. Tu padre dice que nunca ha visto a nadie tan cabezota ni tan noble a la vez, y que eso no lo has perdido con los años. Hemos apartado tres fotos para enmarcarlas en el pasillo; cuando vuelvas te las enseñamos y eliges la que más te guste.';

/** @type {SeedLetter[]} */
export const SEED_LETTERS = [
  {
    id: 'asunto-explicito',
    tests: 'Asunto «Carta para Nombre Apellido» en texto plano',
    from: from('Rosa Martín', 'rosa.martin'),
    subject: 'Carta para Manuel García',
    text: para(
      'Mi amor:',
      'Desde que te fuiste el viernes la casa está muy silenciosa. Los chicos preguntan cada noche a qué hora vuelves y el pequeño ha decidido que no se acuesta hasta que le cuente qué estarás haciendo. Le he dicho que estás descansando, rezando y conociendo a gente buena, y se ha quedado muy conforme.',
      'Llevamos veintiséis años juntos y pocas veces te he visto tan ilusionado por algo que fuera para ti. Siempre estás pendiente de todos: del trabajo, de tus padres, de nosotros. Estos días son tuyos. Aprovecha cada momento, escucha mucho y no tengas miedo de abrir el corazón.',
      'Aquí todo está en orden: la caldera ya funciona, el coche pasó la revisión y tu madre ha llamado dos veces para preguntar si comes bien. Le he dicho que sí, que seguro que mejor que en casa.',
      'Te queremos muchísimo ❤️',
      'Un abrazo enorme,\nRosa',
    ),
    when: [6, '09:12'],
    expect: { status: 'ASSIGNED', participants: ['manuel-garcia'] },
  },
  {
    id: 'saludo-cuerpo',
    tests: 'Solo el saludo del cuerpo identifica al destinatario («Querido Juan:»)',
    from: from('Pilar Sanz', 'pilar.sanz'),
    subject: 'Ánimo desde Zaragoza',
    ...styled(
      para(
        'Querido Juan:',
        'Tu hermana y yo hemos encendido una vela por ti esta mañana en la basílica, delante de la Virgen, como hacíamos de jóvenes antes de los exámenes. Nos hemos acordado de lo que te costó decidirte a ir y de lo contento que estabas cuando por fin dijiste que sí.',
        'A estas alturas de la vida uno cree que ya lo ha visto todo, pero siempre queda algo por descubrir. Déjate sorprender. Habla poco, escucha mucho y no te preocupes por nada de aquí: tus nietos están bien, la huerta la riega tu cuñado y el perro se ha portado como un señor.',
        'Cuando vuelvas te esperamos con croquetas de las de verdad y con ganas de que nos lo cuentes todo despacio, con un café delante.',
        'Muchos besos,\nTu hermana Pilar',
      ),
      'warm',
    ),
    when: [6, '10:05'],
    expect: { status: 'ASSIGNED', participants: ['juan-martinez'] },
  },
  {
    id: 'alias-asunto',
    tests: 'Alias en el asunto («Para Nacho» → José Ignacio Sanz)',
    from: from('Familia Sanz', 'familia.sanz'),
    subject: 'Para Nacho',
    ...styled(
      para(
        '¡Hola, campeón!',
        'Lucía ha hecho galletas con forma de estrella para cuando vuelvas y dice que no te va a dejar ninguna si no le cuentas todo con detalle. Los niños han pintado un cartel enorme de bienvenida que pensamos colgar en la puerta, así que prepárate.',
        'Te echamos de menos en la mesa, sobre todo en la cena, cuando nadie cuenta chistes malos. Disfruta mucho, descansa y vuelve con las pilas cargadas.',
        'Un abrazo muy fuerte de los cuatro.',
      ),
      'kids',
    ),
    when: [6, '12:30'],
    expect: { status: 'ASSIGNED', participants: ['jose-ignacio-sanz'] },
  },
  {
    id: 'asunto-corchetes',
    tests: 'Asunto con corchetes «[Para: Nombre]»',
    from: from('Jorge Vázquez', 'jorge.vazquez'),
    subject: '[Para: Iván Vázquez] Desde Valencia',
    ...styled(
      para(
        'Querido Iván:',
        'Te escribimos desde Valencia, donde hace un sol espléndido aunque ya estemos en noviembre. Tu madre dice que esto no es otoño ni es nada, y que en Caracas por lo menos llovía con ganas.',
        'Han pasado ya seis años desde que llegaste y todavía me acuerdo del primer día en el aeropuerto, con una maleta y muchas ganas. Has trabajado muchísimo y has sabido hacerte un sitio. Estamos muy orgullosos del hombre en que te has convertido.',
        'Tus primos te mandan recuerdos y dicen que a la vuelta te toca organizar la paella, que el año pasado se te pegó el arroz y no te lo van a perdonar nunca.',
        'Un abrazo de toda la familia,\nPapá',
      ),
      'modern',
    ),
    when: [5, '09:00'],
    expect: { status: 'ASSIGNED', participants: ['ivan-vazquez'] },
  },
  {
    id: 'mayusculas-sin-tildes',
    tests: 'Asunto en mayúsculas y sin tildes («BORJA IBAÑEZ»)',
    from: from('Amaia Ibáñez', 'amaia.ibanez'),
    subject: 'CARTA PARA BORJA IBAÑEZ',
    ...styled(
      para(
        'Querido Borja:',
        'Perdona las mayúsculas del asunto, el sobrino me ha cambiado algo en el móvil y no sé quitarlo. Te pensamos mucho estos días. Ama dice que reza por ti cada noche y aita, que no es de muchas palabras, pregunta todos los días si ya ha llegado alguna noticia tuya.',
        'Eres el hermano pequeño, pero muchas veces pareces el mayor. Gracias por cómo cuidaste de todos el año pasado, cuando las cosas se pusieron difíciles. Ahora te toca a ti dejarte cuidar un poco.',
        'Un beso grande,\nAmaia',
      ),
      'office',
    ),
    when: [5, '10:40'],
    expect: { status: 'ASSIGNED', participants: ['borja-ibanez'] },
  },
  {
    id: 'ambigua-manuel',
    tests: 'Nombre de pila compartido por dos participantes («Querido Manuel:») → Por revisar',
    from: from('Familia Blanco', 'familia.blanco'),
    subject: 'Unas líneas para ti',
    ...styled(
      para(
        'Querido Manuel:',
        'Te escribimos todos juntos desde la mesa de la cocina, como en los viejos tiempos. Andrés ha hecho un dibujo que te guardamos para cuando vuelvas y la abuela insiste en que te digamos que te abrigues por las noches, que en la sierra refresca.',
        'Gracias por ser como eres con todos nosotros. Disfruta de estos días, que te los mereces.',
        'Con todo nuestro cariño,\nLa familia Blanco',
      ),
      'classic',
    ),
    when: [5, '11:30'],
    expect: { status: 'NEEDS_REVIEW', suggestions: ['manuel-garcia', 'manuel-lopez'] },
  },
  {
    id: 'ambigua-pablo',
    tests: 'Otro nombre compartido («Querido Pablo:») → Por revisar',
    from: from('Marisa Gómez', 'marisa.gomez'),
    subject: 'Desde casa',
    ...styled(
      para(
        'Querido Pablo:',
        'Soy Marisa, del grupo de matrimonios de la parroquia. Te escribo para decirte que estoy muy contenta de que hayas dado el paso de ir al retiro. Sé que no ha sido fácil organizarlo con el trabajo y los niños, y por eso tiene todavía más valor.',
        'Escucha mucho, descansa y deja que el Señor haga su parte. A la vuelta nos vemos en la reunión del jueves y nos cuentas.',
        'Un abrazo grande,\nMarisa',
      ),
      'warm',
    ),
    when: [5, '13:15'],
    expect: { status: 'NEEDS_REVIEW', suggestions: ['pablo-ortega', 'pablo-ruiz'] },
  },
  {
    id: 'ambigua-resuelta',
    tests: 'Saludo ambiguo resuelto por el nombre completo en el asunto',
    from: from('Carmen Ruiz', 'carmen.ruiz'),
    subject: 'Carta para Pablo Ortega',
    ...styled(
      para(
        'Querido Pablo:',
        'Te escribo rápido antes de salir a trabajar. Solo quería decirte que estamos contigo y que rezamos por ti cada noche. La rodilla seguro que aguanta; tú no te hagas el valiente en la excursión y pide ayuda si la necesitas, que para eso están los demás.',
        'Treinta y cinco años casados y sigues sorprendiéndome. Disfruta, que a la vuelta te espera tu cocido de los domingos.',
        'Un beso muy fuerte,\nCarmen',
      ),
      'classic',
    ),
    when: [5, '18:45'],
    expect: { status: 'ASSIGNED', participants: ['pablo-ortega'] },
  },
  {
    id: 'varios-asunto',
    tests: 'Carta para dos participantes nombrados en el asunto',
    from: from('Tía Teresa', 'teresa.fernandez'),
    subject: 'Carta para Juan y Lucas',
    ...styled(
      para(
        'Queridos los dos:',
        'Qué alegría saber que estáis juntos en el retiro. Quién nos iba a decir, cuando os conocisteis en aquella boda en Mendoza, que acabaríais siendo tan amigos y compartiendo estos días tan especiales.',
        'Cuidaos el uno al otro, reíd mucho y no os quedéis con nada dentro. Os llevo en mis oraciones todas las noches.',
        'Besos de vuestra tía,\nTeresa',
      ),
      'hand',
    ),
    when: [4, '12:00'],
    expect: { status: 'ASSIGNED', participants: ['juan-martinez', 'lucas-fernandez'], flags: ['MULTI_RECIPIENT'] },
  },
  {
    id: 'varios-cuerpo',
    tests: 'Carta para dos participantes nombrados en el saludo del cuerpo',
    from: from('Tíos de Burgos', 'tios.burgos'),
    subject: 'Para los dos',
    ...styled(
      para(
        'Queridos Diego y Nicolás:',
        'Nos ha hecho mucha ilusión saber que coincidís en el retiro. Aprovechad para conoceros más, para descansar del trabajo y para mirar hacia dentro, que el día a día no nos deja.',
        'Aquí en Burgos ya ha caído la primera helada. Cuando volváis os invitamos a morcilla y a lechazo, que hay que reponer fuerzas.',
        'Un abrazo de vuestros tíos.',
      ),
      'modern',
    ),
    when: [4, '13:20'],
    expect: { status: 'ASSIGNED', participants: ['diego-navarro', 'nicolas-prieto'], flags: ['MULTI_RECIPIENT'] },
  },
  {
    id: 'remitente-trampa',
    tests: 'El remitente se llama como otro participante (Lucas Fernández) y firma con su nombre: no debe asignarse a él',
    from: from('Lucas Fernández', 'lucas.fernandez.tio'),
    subject: 'Ánimo, sobrino',
    ...styled(
      para(
        'Querido Diego:',
        'Te escribe tu tío desde Granada. Me han dicho que estás muy contento y que has hecho amigos nuevos. Eso es lo más importante: los amigos de verdad se cuentan con los dedos de una mano y a veces aparecen donde menos lo esperas.',
        'Yo hice un retiro como ese hace muchos años y todavía me acuerdo de la última noche. No te digo nada más para no estropearte la sorpresa.',
        'Un abrazo,\nLucas Fernández',
      ),
      'classic',
    ),
    when: [4, '17:05'],
    expect: { status: 'ASSIGNED', participants: ['diego-navarro'] },
  },
  {
    id: 'respuesta-citada',
    tests: 'Respuesta que cita otro correo que nombra a otro participante (la cita se ignora)',
    from: from('Luis Romero', 'luis.romero'),
    subject: 'Re: Cartas para el retiro',
    text: 'Querido Sergio:\n\nAquí va mi carta, como pedían desde la organización. Estoy muy contento de que hayas decidido ir. Tu madre estaría orgullosísima; seguro que desde el cielo está sonriendo.\n\nYa sabes que a mí me cuesta decir estas cosas en voz alta, así que aprovecho que es por escrito: eres un buen hijo y un buen padre. Cuando vuelvas, nos vamos tú y yo a pescar al pantano, como cuando eras un chaval 🎣\n\nTe quiere,\nPapá\n\nEl lun, 16 nov 2026 a las 21:04, Coordinación Retiro <coordinacion@familias-prueba.example> escribió:\n> Queridas familias:\n> Recordad que el plazo para escribir a Mario Gil y al resto del grupo termina el jueves.\n> Un saludo,\n> Coordinación',
    when: [4, '08:20'],
    expect: { status: 'ASSIGNED', participants: ['sergio-romero'] },
  },
  {
    id: 'reenviado',
    tests: 'Carta reenviada: se ignoran las cabeceras del reenvío y se lee la carta de dentro',
    from: from('Andrea Prieto', 'andrea.prieto'),
    subject: 'Fwd: carta de tu madre',
    text: 'Te reenvío la carta de tu madre, que no sabe usar el correo del retiro y me la mandó a mí.\n\n---------- Forwarded message ---------\nDe: Mamá Gloria <gloria.prieto@familias-prueba.example>\nDate: dom, 15 nov 2026, 19:00\nSubject: Para Nicolás\nTo: andrea.prieto@familias-prueba.example\n\nQuerido Nicolás:\n\nEstoy muy orgullosa de ti, mijo. Desde Quito no paro de pensar en lo lejos que llegaste y en lo bien que cuidas de tu familia. Reza un poquito por tu madre, que yo rezo mucho por ti.\n\nTu mamá, Gloria',
    when: [4, '19:30'],
    expect: { status: 'ASSIGNED', participants: ['nicolas-prieto'] },
  },
  {
    id: 'cita-outlook',
    tests: 'Respuesta de Outlook con bloque «De/Enviado/Para/Asunto» que menciona a otro participante',
    from: from('Begoña Serrano', 'begona.serrano'),
    subject: 'RE: Carta',
    text: 'Hola Hugo,\n\nTe escribo en el descanso del trabajo. Las niñas y yo estamos deseando que nos cuentes todo. La mayor ha preguntado si allí hay wifi y le he dicho que no, que es parte de la gracia. ¡Disfruta mucho!\n\nUn beso,\nBegoña\n\n________________________________\nDe: Coordinación Retiro <coordinacion@familias-prueba.example>\nEnviado: lunes, 16 de noviembre de 2026 21:04\nPara: Familias\nAsunto: Cartas\n\nRecordad que todavía nadie ha escrito a Claudio Molina.',
    when: [3, '10:10'],
    expect: { status: 'ASSIGNED', participants: ['hugo-serrano'] },
  },
  {
    id: 'solo-html',
    tests: 'Correo solo en HTML con estilos, un <script> y una imagen remota de seguimiento (se quitan; se conserva el formato)',
    from: from('Familia Gil', 'familia.gil'),
    subject: 'Para Mario',
    html: '<html><head><style>p{color:#333;font-family:Arial}</style></head><body><div style="font-size:18px;color:#1b4965;font-family:Georgia,serif"><b>Querido Mario:</b></div><div><br></div><p style="font-family:Georgia,serif">Te hemos preparado una <b>sorpresa</b> para cuando vuelvas. No te podemos decir nada más &#128521;</p><ul><li>Pista 1: <span style="color:#c1121f">es grande</span></li><li>Pista 2: <span style="color:#2a9d8f">hace ruido</span></li><li>Pista 3: <i>tiene ruedas</i></li></ul><p style="font-family:Georgia,serif">Estamos muy contentos de que te animaras a ir. A tu edad nosotros no habríamos tenido el valor de pasar un fin de semana entero sin móvil.</p><p style="font-family:Georgia,serif;color:#1b4965"><i>Te queremos,<br>Tus padres</i></p><script>alert("hola")</script><img src="https://tracker.example/pixel.gif" width="1" height="1"></body></html>',
    when: [3, '11:45'],
    expect: { status: 'ASSIGNED', participants: ['mario-gil'] },
  },
  {
    id: 'texto-y-html',
    tests: 'multipart/alternative (texto + HTML): se reconoce con el texto y se muestra con formato',
    from: from('Antonio Herrera', 'antonio.herrera'),
    subject: 'Carta para Álvaro',
    text: 'Querido hijo:\n\nEsta mañana, desayunando, tu madre y yo hablábamos de lo rápido que pasa el tiempo. Parece que fue ayer cuando te enseñé a montar en bici en el parque, y ahora eres tú el que me enseña a mí a usar el móvil.\n\nEstamos muy orgullosos de ti, del trabajo que has encontrado y de cómo tratas a la gente.\n\nUn abrazo fuerte,\nPapá',
    html: '<div style="font-family:\'Palatino Linotype\',Palatino,serif;font-size:16px;color:#333"><p style="color:#6a040f;font-size:20px"><b>Querido hijo:</b></p><p>Esta mañana, desayunando, tu madre y yo hablábamos de lo rápido que pasa el tiempo. Parece que fue ayer cuando te enseñé a montar en bici en el parque, y ahora eres tú el que me enseña a mí a usar el móvil.</p><p style="background-color:#fff3bf">Estamos <b>muy orgullosos</b> de ti, del trabajo que has encontrado y de cómo tratas a la gente.</p><p style="color:#6a040f"><i>Un abrazo fuerte,<br>Papá</i></p></div>',
    when: [3, '12:30'],
    expect: { status: 'ASSIGNED', participants: ['alvaro-herrera'] },
  },
  {
    id: 'latin1',
    tests: 'Texto en codificación ISO-8859-1 (tildes y ñ deben verse bien)',
    from: from('Mamá de Borja', 'madre.ibanez'),
    subject: 'Carta para Borja',
    text: 'Querido Borja:\n\nTu madre te escribe desde el ordenador viejo de tu padre, que tiene las letras raras pero todavía funciona. Este año has trabajado muchísimo y te veíamos cansado; me alegra mucho que te tomes estos días para ti.\n\nPara mí sigues siendo mi niño, aunque midas un metro noventa y lleves barba. Mañana hago tu bizcocho de limón para cuando vuelvas.\n\nUn beso muy grande,\nAma',
    textCharset: 'iso-8859-1',
    when: [3, '16:00'],
    expect: { status: 'ASSIGNED', participants: ['borja-ibanez'] },
  },
  {
    id: 'emojis',
    tests: 'Asunto y cuerpo llenos de emojis',
    from: from('Sofía Fernández', 'sofia.fernandez'),
    subject: '🌟 Para Lucas 🌟',
    ...styled(
      para(
        '¡¡Papiiii!! 🥳🥳',
        'Te echo muchísimo de menos 😭 El perro está triste 🐶 y mamá no deja de mirar tus fotos 📸 Ayer hicimos pizza 🍕 y nos salió fatal sin ti, la masa parecía una suela 😂',
        'Cuando vuelvas, maratón de pelis 🍿🎬 y me enseñas a tocar la guitarra como prometiste 🎸 ¡No vale escaquearse!',
        'Te quiero muchísimo 💖✨\nSofi',
      ),
      'kids',
    ),
    when: [3, '18:20'],
    expect: { status: 'ASSIGNED', participants: ['lucas-fernandez'] },
  },
  {
    id: 'medianoche-antes',
    tests: 'Recibida a las 23:50 (hora de Madrid): agrupación por día y filtro de fecha',
    from: from('Ricardo Fernández', 'ricardo.fdez'),
    subject: 'Carta para Lucas Fernández',
    ...styled(
      para(
        'Querido hermano:',
        'Es casi medianoche y no podía irme a dormir sin escribirte. Hoy he pasado por delante del bar donde veíamos los partidos de Boca con papá y me he acordado de lo que gritabas en cada gol, aunque fuera del contrario.',
        'Has cruzado un océano, has levantado una familia y un negocio, y nunca te has olvidado de nadie. Confío en ti y te admiro más de lo que te digo.',
        'Buenas noches y un abrazo,\nRicardo',
      ),
      'classic',
    ),
    when: [3, '23:50'],
    expect: { status: 'ASSIGNED', participants: ['lucas-fernandez'] },
  },
  {
    id: 'medianoche-despues',
    tests: 'Recibida a las 00:10 del día siguiente (hora de Madrid)',
    from: from('Elena Ríos', 'elena.rios'),
    subject: 'Buenas noches',
    ...styled(
      para(
        '¡Hola, Lucas!',
        'Te escribo ya pasada la medianoche porque acabo de salir del turno del hospital. Todo bien por casa: la niña ha hecho los deberes sin protestar (milagro) y el perro sigue durmiendo en tu lado de la cama.',
        'Recuerda lo que hablamos antes de que te fueras: no tienes que tener todas las respuestas. Basta con que estés ahí.',
        'Un abrazo grande,\nElena',
      ),
      'hand',
    ),
    when: [2, '00:10'],
    expect: { status: 'ASSIGNED', participants: ['lucas-fernandez'] },
  },
  {
    id: 'nombre-completo-cuerpo',
    tests: 'Saludo con nombre y apellido en el cuerpo («Querido Pablo Ortega:»)',
    from: from('Andrés Padilla', 'andres.padilla'),
    subject: 'Desde Sevilla',
    ...styled(
      para(
        'Querido Pablo Ortega:',
        'Sí, te pongo el apellido porque me han dicho que hay dos con tu nombre en el grupo y no quiero que mi carta acabe en manos equivocadas 😉',
        'Cuarenta años de amistad dan para mucho: la mili, las bodas, los bautizos, alguna que otra pena. En todas has estado tú. Ahora me toca a mí estar contigo, aunque sea desde Sevilla y por carta.',
        'Un abrazo de tu amigo,\nAndrés',
      ),
      'warm',
    ),
    when: [2, '10:00'],
    expect: { status: 'ASSIGNED', participants: ['pablo-ortega'] },
  },
  {
    id: 'respuesta-automatica',
    tests: 'Respuesta automática (Auto-Submitted): se marca con aviso pero sigue contando',
    from: from('Antonio Ortega', 'antonio.ortega'),
    subject: 'Respuesta automática: Carta para Pablo Ortega',
    headers: { 'Auto-Submitted': 'auto-replied', 'X-Autoreply': 'yes' },
    text: 'Gracias por su mensaje.\n\nMe encuentro fuera de la oficina hasta el lunes 24 de noviembre, con acceso limitado al correo. Si el asunto es urgente, contacte con recepción.\n\nUn saludo,\nAntonio Ortega',
    when: [2, '11:31'],
    expect: { status: 'ASSIGNED', participants: ['pablo-ortega'], flags: ['AUTO_REPLY'] },
  },
  {
    id: 'boletin',
    tests: 'Boletín masivo con mucho formato (List-Unsubscribe, Precedence: bulk) → aviso «Envío masivo», Por revisar',
    from: from('Parroquia San Miguel', 'boletin.parroquia'),
    subject: 'Boletín semanal de la parroquia',
    headers: { 'List-Unsubscribe': '<mailto:baja@familias-prueba.example>', Precedence: 'bulk', 'List-Id': 'Boletin <boletin.familias-prueba.example>' },
    html: '<div style="font-family:\'Trebuchet MS\',Arial,sans-serif;color:#222"><h1 style="color:#ffffff;background-color:#264653;text-align:center">Boletín semanal</h1><p style="text-align:center;color:#6c757d">Parroquia de San Miguel · Noviembre</p><h2 style="color:#e76f51">Retiro de hombres</h2><p>Esta semana celebramos el retiro de hombres. Os pedimos oraciones por los participantes y por el equipo que les sirve en la cocina, en la capilla y en las habitaciones.</p><h2 style="color:#2a9d8f">Agenda</h2><table><tr><th style="text-align:left">Día</th><th style="text-align:left">Actividad</th></tr><tr><td>Martes</td><td>Grupo de oración (20:00)</td></tr><tr><td>Jueves</td><td>Reunión de matrimonios</td></tr><tr><td style="background-color:#fff3bf">Domingo</td><td style="background-color:#fff3bf">Chocolate con churros a la salida de misa</td></tr></table><hr><p style="font-size:12px;color:#6c757d">Recibes este boletín porque estás suscrito. <a href="https://example.org/baja">Darse de baja</a></p></div>',
    when: [2, '07:00'],
    expect: { status: 'NEEDS_REVIEW', suggestions: [], flags: ['NEWSLETTER_OR_BULK'] },
  },
  {
    id: 'rebote',
    tests: 'Notificación de error de entrega (mailer-daemon) → aviso «Error de entrega», Por revisar',
    from: { name: 'Mail Delivery Subsystem', address: `mailer-daemon@${SEED_SENDER_DOMAIN}` },
    subject: 'Delivery Status Notification (Failure)',
    text: 'No se ha podido entregar el mensaje a cartas.retiro.antiguo@familias-prueba.example porque la dirección no existe.\n\nEl servidor remoto ha respondido: 550 5.1.1 The email account that you tried to reach does not exist.',
    when: [2, '08:15'],
    expect: { status: 'NEEDS_REVIEW', suggestions: [], flags: ['MAILER_DAEMON'] },
  },
  {
    id: 'solo-firma',
    tests: 'Correo que solo contiene «Enviado desde mi iPhone» → aviso «Solo firma», Por revisar',
    from: from('Rafa Prieto', 'rafa.prieto'),
    subject: '',
    text: '\n\nEnviado desde mi iPhone',
    when: [2, '09:02'],
    expect: { status: 'NEEDS_REVIEW', suggestions: [], flags: ['SIGNATURE_ONLY'] },
  },
  {
    id: 'solo-escaneo',
    tests: 'Solo un escaneo JPEG girado (EXIF), sin texto → «Solo adjuntos», Por revisar (la miniatura dice para quién es)',
    from: from('Familia Ezquerra', 'familia.ezquerra'),
    subject: 'Escaneo',
    text: '',
    attachments: async () => [
      {
        filename: 'IMG_20261117_204512.jpg',
        mimeType: 'image/jpeg',
        data: await letterImage(
          ['Querido Íñigo:', '', 'Como los niños querían escribirte a mano,', 'te mandamos la carta escaneada.', '', 'Estamos muy orgullosos de ti.', 'El perro te busca por toda la casa.', '', 'Te queremos muchísimo.', '', 'Ane, Jon y Maite'],
          { rotateExif: true },
        ),
      },
    ],
    when: [2, '12:15'],
    expect: { status: 'NEEDS_REVIEW', suggestions: [], flags: ['ATTACHMENT_ONLY', 'HAS_ATTACHMENTS'] },
  },
  {
    id: 'escaneo-jpeg',
    tests: 'Carta escaneada a mano (JPEG girado con EXIF) con unas líneas de texto',
    from: from('Inés Moreno', 'ines.moreno'),
    subject: 'Carta para Javi',
    ...styled(
      para(
        'Hola, cariño:',
        'Te mando escaneada la carta que te ha escrito tu madre a mano, que ya sabes que ella no se apaña con el ordenador. Va en el archivo adjunto; la letra es suya, temblorosa pero preciosa.',
        'Aquí todo bien. Te echamos de menos.',
        'Besos,\nInés',
      ),
      'office',
    ),
    attachments: async () => [
      {
        filename: 'carta-de-tu-madre.jpg',
        mimeType: 'image/jpeg',
        data: await letterImage(
          ['Querido Javi:', '', 'Inés me ha dicho que estás de retiro', 'y no he querido dejar pasar la ocasión.', '', 'Me acuerdo de cuando volvías del colegio', 'y merendabas pan con chocolate.', '¡Cuánto has crecido, hijo!', '', 'Aquí te espero con un abrazo muy fuerte.', '', 'Tu madre, Maruja'],
          { rotateExif: true },
        ),
      },
    ],
    when: [2, '13:40'],
    expect: { status: 'ASSIGNED', participants: ['javier-moreno'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'pdf',
    tests: 'Carta en PDF adjunto («Abrir PDF», vista previa)',
    from: from('Tomás Delgado', 'tomas.delgado'),
    subject: 'Carta para Carlos Delgado',
    ...styled(
      para(
        'Querido Carlos:',
        'Te adjunto la carta en PDF porque la he escrito con calma en el ordenador y quería que te llegara bien maquetada. Tu madre la ha leído antes de mandarla y dice que me he quedado corto.',
        'Te queremos mucho.',
        'Papá y mamá',
      ),
      'classic',
    ),
    attachments: async () => [
      {
        filename: 'Carta para Carlos.pdf',
        mimeType: 'application/pdf',
        data: buildPdf([
          'Querido Carlos:',
          '',
          'Cuando salimos de Lima con dos maletas y tú con nueve años, no sabíamos',
          'qué nos esperaba. Hoy te miramos y sabemos que mereció la pena.',
          '',
          'Eres un padre paciente, un marido atento y un hijo que nunca se olvida',
          'de llamar los domingos. Estamos muy orgullosos de ti.',
          '',
          'Aprovecha estos días para descansar y para dar gracias.',
          '',
          'Te queremos mucho.',
          '',
          'Papá y mamá',
        ]),
      },
    ],
    when: [1, '11:05'],
    expect: { status: 'ASSIGNED', participants: ['carlos-delgado'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'docx-con-texto',
    tests: 'Carta en Word (.docx) con unas líneas en el cuerpo: el texto del Word se muestra dentro de la carta',
    from: from('Begoña Navarro', 'begona.navarro'),
    subject: 'Para Diego',
    ...styled(
      para(
        'Hola Diego:',
        'Te envío la carta en un documento de Word, que es donde la he ido escribiendo estos días poco a poco, entre reunión y reunión.',
        '¡Mucho ánimo, campeón!',
      ),
      'modern',
    ),
    attachments: async () => [
      {
        filename: 'Carta Diego.docx',
        mimeType: DOCX_MIME,
        data: buildDocx([
          'Querido Diego:',
          '',
          'Llevo varios días escribiendo esta carta a ratos.',
          'Eres el mejor hermano que podría tener, aunque de pequeños nos peleáramos por el mando de la tele.',
          'Gracias por estar siempre, sobre todo cuando papá enfermó.',
          '',
          'Un abrazo enorme,',
          'Begoña',
        ]),
      },
    ],
    when: [1, '13:22'],
    expect: { status: 'ASSIGNED', participants: ['diego-navarro'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'docx-casi-sin-texto',
    tests: 'La carta entera va en el Word; el cuerpo solo dice que va adjunta',
    from: from('Luis Romero', 'luis.romero.papa'),
    subject: 'Carta para Sergio',
    text: 'Va en el documento adjunto, que lo he escrito con el ordenador del trabajo.',
    attachments: async () => [
      {
        filename: 'carta-sergio.docx',
        mimeType: DOCX_MIME,
        data: buildDocx([
          'Querido Sergio:',
          '',
          'Te escribo desde la oficina en un rato libre.',
          'Estamos muy orgullosos de ti y de cómo has sacado adelante a los chicos este año.',
          '',
          'Cuando vuelvas, vamos al partido, que tengo dos entradas.',
          '',
          'Papá',
        ]),
      },
    ],
    when: [1, '15:00'],
    expect: { status: 'ASSIGNED', participants: ['sergio-romero'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'imagen-incrustada',
    tests: 'Foto incrustada en el texto (cid:): debe aparecer en su sitio, dentro de la carta',
    from: from('Clara García', 'clara.garcia'),
    subject: '¡Mira quién te saluda!',
    text: 'Querido Manolo:\n\nToby no deja de buscarte por toda la casa. Aquí lo tienes:\n\n[cid:toby@familias-prueba.example]\n\nTe echa de menos casi tanto como yo.\n\nTu hija,\nClara',
    html: '<div style="font-family:\'Trebuchet MS\',Arial,sans-serif;font-size:16px;color:#333"><p style="color:#0b7285;font-size:20px"><b>Querido Manolo:</b></p><p>Toby no deja de buscarte por toda la casa. Aquí lo tienes:</p><p style="text-align:center"><img src="cid:toby@familias-prueba.example" alt="Toby"></p><p>Te echa de menos <span style="color:#d6336c"><b>casi tanto como yo</b></span>.</p><p style="color:#0b7285"><i>Tu hija,<br>Clara</i></p></div>',
    attachments: async () => [{ filename: 'toby.png', mimeType: 'image/png', data: await drawing('Toby te echa de menos'), contentId: 'toby@familias-prueba.example' }],
    when: [1, '16:30'],
    expect: { status: 'ASSIGNED', participants: ['manuel-garcia'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'foto-webp',
    tests: 'Foto adjunta en formato WEBP',
    from: from('Jorge Vázquez', 'jorge.vazquez.papa'),
    subject: 'Carta para Iván',
    ...styled(
      para(
        'Querido Iván:',
        'Te mandamos una foto de la última excursión a la sierra para que te acuerdes de nosotros. ¡Qué bien lo pasamos, aunque tu madre se quejara de las cuestas todo el camino!',
        'Un abrazo de los tres.',
      ),
      'modern',
    ),
    attachments: async () => [{ filename: 'excursion.webp', mimeType: 'image/webp', data: await letterImage(['Excursión a la sierra', '', '¡Te echamos de menos!'], { format: 'webp', height: 700 }) }],
    when: [1, '17:10'],
    expect: { status: 'ASSIGNED', participants: ['ivan-vazquez'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'gif',
    tests: 'Imagen GIF adjunta',
    from: from('Laura Serrano', 'laura.serrano'),
    subject: 'Para Hugo',
    ...styled(
      para(
        'Querido Hugo:',
        'Te he hecho un dibujo con el ordenador. Ya sé que no es una obra de arte, pero está hecho con mucho cariño por tu hermana pequeña, que te sigue admirando como cuando tenía diez años.',
        'Tu hermana Laura',
      ),
      'kids',
    ),
    attachments: async () => [{ filename: 'dibujo.gif', mimeType: 'image/gif', data: await letterImage(['¡Ánimo, hermano!', '', 'De tu hermana que te quiere'], { format: 'gif', width: 800, height: 600 }) }],
    when: [1, '18:00'],
    expect: { status: 'ASSIGNED', participants: ['hugo-serrano'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'heic',
    tests: 'Foto HEIC de iPhone (el sharp estándar no la convierte: se ofrece descargar el original)',
    from: from('Rosario Prieto', 'rosario.prieto'),
    subject: 'Carta para Nicolás',
    ...styled(
      para(
        'Querido Nicolás:',
        'Te mando una foto que te hicimos en el cumpleaños de tu suegro. La he sacado con el iPhone, espero que se vea bien. Saliste con los ojos cerrados, como siempre, pero es la única en la que estamos todos.',
        'Un beso enorme,\nTu cuñada Rosario',
      ),
      'office',
    ),
    attachments: async () => [{ filename: 'IMG_1234.HEIC', mimeType: 'image/heic', data: fakeHeic() }],
    when: [1, '19:15'],
    expect: { status: 'ASSIGNED', participants: ['nicolas-prieto'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'video',
    tests: 'Vídeo adjunto (.mov): «Adjunto no imprimible» con descarga',
    from: from('Familia Gil', 'familia.gil.video'),
    subject: 'Carta para Mario Gil',
    ...styled(
      para(
        'Querido Mario:',
        'Como nos dijiste que te encantaría oírnos, te hemos grabado un vídeo todos juntos, hasta el abuelo, que no sabía hacia dónde mirar.',
        'Te queremos.',
        'Tus padres y tus hermanos',
      ),
      'modern',
    ),
    attachments: async () => [{ filename: 'video-familia.mov', mimeType: 'video/quicktime', data: fakeMov() }],
    when: [1, '20:00'],
    expect: { status: 'ASSIGNED', participants: ['mario-gil'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'zip',
    tests: 'Archivo comprimido (.zip): «Adjunto no imprimible» con descarga',
    from: from('Antonio Herrera', 'antonio.herrera.fotos'),
    subject: 'Carta para Álvaro',
    ...styled(
      para('Querido Álvaro:', 'Te mando en un zip las fotos del viaje a Asturias, que pesaban mucho para mandarlas sueltas. Hay una tuya en los Lagos de Covadonga que tu madre quiere enmarcar.', 'Un abrazo,\nPapá'),
      'classic',
    ),
    attachments: async () => [{ filename: 'fotos-asturias.zip', mimeType: 'application/zip', data: buildZip([{ name: 'leeme.txt', data: 'Fotos del viaje a Asturias' }]) }],
    when: [1, '20:40'],
    expect: { status: 'ASSIGNED', participants: ['alvaro-herrera'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'svg-bloqueado',
    tests: 'Adjunto SVG: bloqueado por seguridad (ni se procesa ni se descarga)',
    from: from('Sobrino Rubén', 'ruben.martinez'),
    subject: 'Carta para Juan',
    ...styled(
      para('Querido Juan:', 'Te mando un dibujo que he hecho con el ordenador del cole. Es una naranja, aunque parezca una pelota. Espero que te guste mucho, tío.', 'Tu sobrino Rubén'),
      'kids',
    ),
    attachments: async () => [
      {
        filename: 'dibujo.svg',
        mimeType: 'image/svg+xml',
        data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" onload="alert(1)"><circle cx="50" cy="50" r="40" fill="orange"/></svg>'),
      },
    ],
    when: [1, '21:10'],
    expect: { status: 'ASSIGNED', participants: ['juan-martinez'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'tipo-falso',
    tests: 'Adjunto «foto.png» que en realidad no es una imagen (se detecta por su contenido)',
    from: from('Rocío Torres', 'rocio.torres'),
    subject: 'Carta para Curro',
    ...styled(
      para('Querido Curro:', 'Te adjunto la foto que me pediste de los niños en la playa, aunque el móvil hizo algo raro al guardarla. Si no se ve, ya te la enseño en casa.', 'Rocío'),
      'office',
    ),
    attachments: async () => [{ filename: 'foto.png', mimeType: 'image/png', data: Buffer.from('Esto no es una imagen PNG, es un archivo de texto renombrado.\n') }],
    when: [1, '21:45'],
    expect: { status: 'ASSIGNED', participants: ['francisco-jose-torres'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'solo-mencion',
    tests: 'Solo se menciona el nombre completo, sin saludo → Por revisar con sugerencia',
    from: from('Grupo de oración', 'grupo.oracion'),
    subject: 'Pensando en vosotros',
    text: 'Esta semana el grupo de oración de los martes ha rezado mucho por Claudio Molina y por todo su grupo del retiro. Os mandamos mucha fuerza y alegría.\n\nUn saludo cariñoso.',
    when: [1, '08:30'],
    expect: { status: 'NEEDS_REVIEW', suggestions: ['claudio-molina'] },
  },
  {
    id: 'saludo-tardio',
    tests: 'El saludo está después de un párrafo muy largo (fuera de los primeros 600 caracteres) → Por revisar',
    from: from('Padres de Hugo', 'padres.serrano'),
    subject: 'Recuerdos de casa',
    ...styled(`${LONG_INTRO}\n\nQuerido Hugo:\n\nTe queremos mucho y te esperamos con los brazos abiertos.\n\nTus padres`, 'warm'),
    when: [1, '09:45'],
    expect: { status: 'NEEDS_REVIEW', suggestions: [] },
  },
  {
    id: 'no-participante',
    tests: 'Saludo a alguien que no está en la lista de participantes → Por revisar sin sugerencias',
    from: from('Familia Pérez', 'familia.perez'),
    subject: 'Ánimo',
    ...styled(
      para('Querido Andrés:', 'Esperamos que estés pasando unos días estupendos. Aquí todos bien, deseando que vuelvas para contárnoslo todo.', 'Un abrazo de toda la familia.'),
      'classic',
    ),
    when: [1, '10:20'],
    expect: { status: 'NEEDS_REVIEW', suggestions: [] },
  },
  {
    id: 'saludo-alias-linea',
    tests: 'Asunto vacío y saludo con alias en una línea («Juanito:»)',
    from: from('Ramón Martínez', 'ramon.martinez'),
    subject: '',
    ...styled(
      para(
        'Juanito:',
        'Tu madre y yo ya no estamos para muchos viajes, pero te acompañamos desde aquí con el pensamiento. Escucha mucho y habla poco, que así se aprende, aunque tengas ya nietos y te creas que lo sabes todo.',
        'Un abrazo muy grande,\nTu padre',
      ),
      'hand',
    ),
    when: [1, '11:40'],
    expect: { status: 'ASSIGNED', participants: ['juan-martinez'] },
  },
  {
    id: 'buenos-dias',
    tests: 'Saludo «Buenos días Nombre,»',
    from: from('Tía Elena', 'elena.romero'),
    subject: 'Un saludo',
    ...styled(
      para('Buenos días Sergio,', 'Tu tía Elena te manda muchos ánimos desde Bilbao. Me han dicho que el sitio del retiro es precioso y que coméis de maravilla, así que no vuelvas más delgado.', 'Un beso fuerte,\nElena'),
      'modern',
    ),
    when: [1, '12:10'],
    expect: { status: 'ASSIGNED', participants: ['sergio-romero'] },
  },
  {
    id: 'cabecera-para',
    tests: 'Cuerpo que empieza con «Para: Nombre» y «De: …» (no es una cita)',
    from: from('Tía Puri', 'puri.gil'),
    subject: 'Carta',
    text: 'Para: Mario Gil\nDe: tu tía Puri\n\nQuerido sobrino:\n\nTe escribo con letra grande para que no te cueste leerla. Pórtate bien, ayuda en lo que puedas y, sobre todo, disfruta. Ya me contarás si allí también te toca fregar.\n\nTu tía que te quiere',
    when: [1, '13:00'],
    expect: { status: 'ASSIGNED', participants: ['mario-gil'] },
  },
  {
    id: 'html-tabla',
    tests: 'HTML con tablas (estilo Outlook)',
    from: from('Patricia Salas', 'patricia.salas'),
    subject: 'Recuerdos',
    html: '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-family:Calibri;font-size:16px;color:#2f5496"><b>Querido Carlos:</b></td></tr><tr><td>&nbsp;</td></tr><tr><td style="font-family:Calibri">Te escribimos desde el ordenador de casa, que he puesto con letra grande. Aquí estamos todos bien y deseando verte. Los niños han hecho una lista de lo que quieren hacer contigo el fin de semana que viene.</td></tr><tr><td>&nbsp;</td></tr><tr><td style="font-family:Calibri;color:#2f5496"><i>Un beso,<br>Patricia</i></td></tr></table>',
    when: [1, '14:30'],
    expect: { status: 'ASSIGNED', participants: ['carlos-delgado'] },
  },
  {
    id: 'mi-querido-alias',
    tests: 'Saludo «Mi querido» con alias y coma',
    from: from('Madrina Lola', 'lola.ramos'),
    subject: 'Desde Córdoba',
    ...styled(
      para('Mi querido Curro, ¿qué tal estás?', 'Tu madrina te manda un abrazo enorme desde Córdoba. Me han dicho que el sitio es precioso, ¡aprovecha! Y no te olvides de rezar un poquito por esta vieja.', 'Te quiero mucho, hijo.', 'Lola'),
      'warm',
    ),
    when: [1, '15:40'],
    expect: { status: 'ASSIGNED', participants: ['francisco-jose-torres'] },
  },
  {
    id: 'manuel-lopez',
    tests: 'Nombre compartido desambiguado por el apellido en el saludo',
    from: from('Guadalupe Ortiz', 'guadalupe.ortiz'),
    subject: 'De tu esposa',
    ...styled(
      para(
        'Querido Manuel López:',
        'Te pongo el apellido porque me han dicho que hay dos Manueles en el grupo 😉',
        'Cuarenta años juntos, desde Guadalajara hasta aquí. Estoy muy orgullosa de ti. Disfruta de cada momento y tómate las pastillas a su hora, que te conozco.',
        'Un abrazo,\nLupita',
      ),
      'warm',
    ),
    when: [1, '17:50'],
    expect: { status: 'ASSIGNED', participants: ['manuel-lopez'] },
  },
  {
    id: 'pablo-ruiz',
    tests: 'El otro Pablo, identificado por el asunto',
    from: from('Familia Ruiz', 'familia.ruiz'),
    subject: 'Carta para Pablo Ruiz',
    ...styled(
      para(
        'Querido Pablo:',
        'Aquí en casa todos bien. El pequeño ha aprendido a silbar y quiere enseñártelo en cuanto vuelvas; lleva dos días practicando y ya no sabemos dónde meternos.',
        'Un beso de todos,\nValentina',
      ),
      'modern',
    ),
    when: [1, '19:30'],
    expect: { status: 'ASSIGNED', participants: ['pablo-ruiz'] },
  },

  // ── Illustrated letters with rich formatting (fonts, colours, headings, tables, photos) ──
  {
    id: 'rica-atardecer',
    tests: 'Carta con mucho formato: Georgia, titular en color, cita destacada y dos fotos incrustadas',
    from: from('Rosa Martín', 'rosa.martin.fotos'),
    subject: 'Carta para Manuel García',
    ...rich(
      `<div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;color:#2b2b2b;line-height:1.7">
        <h1 style="color:#9d0208;font-size:30px;text-align:center">Para ti, Manolo</h1>
        <p style="text-align:center;color:#6c757d;font-style:italic">Veintiséis años después, todavía me haces sonreír</p>
        <p><b style="color:#9d0208">Querido Manolo:</b></p>
        <p>¿Te acuerdas de aquel atardecer en Gredos, el verano que nos conocimos? Nos perdimos bajando del pico, se nos hizo de noche y tú, muy serio, dijiste que sabías perfectamente dónde estábamos. No tenías ni idea. Pero aquella noche, mirando las estrellas, supe que quería perderme contigo muchas más veces.</p>
        <p style="text-align:center">${img('gredos', 'Atardecer en Gredos')}</p>
        <p>Han pasado muchas cosas desde entonces: los niños, las mudanzas, el cáncer de tu padre, el ERE de la fábrica. Nunca te he visto rendirte. A veces creo que no te das cuenta de todo lo que sostienes.</p>
        <blockquote style="color:#6a040f;font-size:20px;font-style:italic;text-align:center;background-color:#fff1e6">«El amor no consiste en mirarse el uno al otro,<br>sino en mirar juntos en la misma dirección.»</blockquote>
        <p>Estos días son para que alguien te sostenga a ti. Déjate querer.</p>
        <p style="text-align:center">${img('familia-garcia', 'Toda la familia en la última Navidad')}</p>
        <hr>
        <p style="color:#9d0208;font-family:'Segoe Script','Comic Sans MS',cursive;font-size:22px;text-align:right">Tu Rosa, siempre</p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('gredos', 'sunset', 'Gredos, el verano que nos conocimos'), await inlineImage('familia-garcia', 'family', 'Navidad en casa')],
    when: [5, '21:30'],
    expect: { status: 'ASSIGNED', participants: ['manuel-garcia'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-dibujo-ninos',
    tests: 'Carta de niños en Comic Sans, letras de colores, lista numerada y un dibujo incrustado',
    from: from('Los niños López', 'ninos.lopez'),
    subject: 'Carta para Manuel López',
    ...rich(
      `<div style="font-family:'Comic Sans MS','Chalkboard SE',cursive;font-size:18px;color:#333">
        <p style="font-size:30px;text-align:center"><span style="color:#e63946">¡</span><span style="color:#f4a261">A</span><span style="color:#2a9d8f">B</span><span style="color:#457b9d">U</span><span style="color:#e76f51">E</span><span style="color:#8338ec">L</span><span style="color:#2a9d8f">O</span><span style="color:#e63946">!</span></p>
        <p>Somos tus nietos. La abuela nos ayuda a escribir pero las ideas son nuestras.</p>
        <p style="text-align:center">${img('dibujo-nietos', 'Dibujo de la casa y la familia')}</p>
        <p>Te hemos hecho este dibujo. Eres el más alto, el del medio. El sol es amarillo porque nos dijiste que allí iba a hacer bueno.</p>
        <h3 style="color:#8338ec">Cosas que haremos cuando vuelvas:</h3>
        <ol>
          <li style="color:#e63946">Ir al parque grande a dar de comer a los patos</li>
          <li style="color:#2a9d8f">Hacer tacos como los de tu pueblo</li>
          <li style="color:#457b9d">Que nos cuentes otra vez lo del burro que se escapó</li>
          <li style="color:#f4a261">Ver el partido los tres juntos</li>
        </ol>
        <p style="font-size:22px;color:#e63946;text-align:center"><b>¡TE QUEREMOS UN MONTÓN!</b> 💛💚💙</p>
        <p style="text-align:right">Mateo (7 años) y Ximena (5 años)</p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('dibujo-nietos', 'crayon', 'Para el abuelo')],
    when: [4, '18:10'],
    expect: { status: 'ASSIGNED', participants: ['manuel-lopez'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-mar',
    tests: 'Palatino con fondo de color, tabla de recuerdos y foto del mar incrustada',
    from: from('Valentina Ruiz', 'valentina.ruiz'),
    subject: 'Carta para Pablo Ruiz',
    ...rich(
      `<div style="font-family:'Palatino Linotype','Book Antiqua',Palatino,serif;font-size:16px;color:#1d3557;background-color:#f1faee;line-height:1.6">
        <h2 style="color:#1d3557;text-align:center">Desde Cartagena hasta aquí</h2>
        <p><b>Querido Pablo:</b></p>
        <p>Hoy he soñado con el mar de Cartagena de Indias, con aquella barca de tu tío y con el olor a pescado frito en la playa. Me he despertado con ganas de escribirte.</p>
        <p style="text-align:center">${img('mar-caribe', 'El mar')}</p>
        <p>Diez años en España, mi amor. Te he hecho una pequeña tabla con lo que hemos vivido:</p>
        <table>
          <tr><th style="text-align:left;color:#e63946">Año</th><th style="text-align:left;color:#e63946">Lo que nunca olvidaré</th></tr>
          <tr><td>2016</td><td>Llegamos con dos maletas y un frío que no conocíamos</td></tr>
          <tr><td>2018</td><td>Nació Santiago, y lloraste más que él</td></tr>
          <tr><td>2021</td><td>Tu primer trabajo fijo: lo celebramos con arepas</td></tr>
          <tr><td style="background-color:#ffe8a3">2026</td><td style="background-color:#ffe8a3"><b>Tu retiro.</b> Estoy muy orgullosa de ti.</td></tr>
        </table>
        <p>No te preocupes por la comida sin gluten: hablé con la organización y lo tienen todo apuntado.</p>
        <p style="font-style:italic;text-align:right;color:#e63946">Con todo mi amor,<br>Valentina</p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('mar-caribe', 'sea', 'Nuestro mar')],
    when: [3, '20:15'],
    expect: { status: 'ASSIGNED', participants: ['pablo-ruiz'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-futbol',
    tests: 'Trebuchet con titulares de colores, tabla de resultados y foto incrustada (carta de un equipo)',
    from: from('Veteranos del Racing', 'veteranos.racing'),
    subject: 'Carta para Javier Moreno',
    ...rich(
      `<div style="font-family:'Trebuchet MS',Arial,sans-serif;font-size:15px;color:#212529">
        <h1 style="color:#ffffff;background-color:#2b9348;text-align:center">⚽ VETERANOS DEL RACING ⚽</h1>
        <p><b style="color:#2b9348">Querido Javi:</b></p>
        <p>El vestuario no es lo mismo sin tus chistes malos ni tus espinilleras de 1998. Te escribimos todos, que para algo eres el capitán.</p>
        <p style="text-align:center">${img('campo-racing', 'El campo')}</p>
        <h3 style="color:#2b9348">Así nos ha ido sin ti</h3>
        <table>
          <tr><th style="text-align:left">Rival</th><th>Resultado</th><th style="text-align:left">Comentario</th></tr>
          <tr><td>Peña El Cruce</td><td style="text-align:center;color:#d00000"><b>1 - 4</b></td><td>Sin capitán no hay orden</td></tr>
          <tr><td>Atlético Barrio Alto</td><td style="text-align:center;color:#6c757d"><b>2 - 2</b></td><td>Empate con sufrimiento</td></tr>
          <tr><td>Deportivo Ribera</td><td style="text-align:center;color:#2b9348"><b>3 - 1</b></td><td>Lo ganamos por ti</td></tr>
        </table>
        <p>Disfruta, descansa y vuelve con fuerzas, que el sábado que viene es el derbi.</p>
        <p style="color:#2b9348;font-weight:bold">¡Aúpa, capitán!<br><span style="font-weight:normal;color:#6c757d">Los veteranos (y el utillero)</span></p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('campo-racing', 'football', 'Te esperamos en el campo')],
    when: [3, '13:05'],
    expect: { status: 'ASSIGNED', participants: ['javier-moreno'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-cumpleanos',
    tests: 'Felicitación con fuentes grandes y colores, lista y foto de una tarta incrustada',
    from: from('Paula Moreno', 'paula.moreno'),
    subject: 'Carta para Javi: ¡feliz cumpleaños, papá!',
    ...rich(
      `<div style="font-family:'Trebuchet MS',Arial,sans-serif;color:#5f0f40;background-color:#fff0f3;line-height:1.6">
        <h1 style="text-align:center;color:#d6336c;font-size:34px">🎉 ¡Feliz cumpleaños, papá! 🎉</h1>
        <p>Ya sé que tu cumpleaños es la semana que viene, pero quería que esta carta te llegara mientras estás allí. Mamá y yo te hemos preparado la tarta de siempre, la de chocolate y fresas, y la guardaremos hasta que vuelvas (o eso dice mamá).</p>
        <p style="text-align:center">${img('tarta', 'Tarta de cumpleaños')}</p>
        <p>Tres cosas que me has enseñado:</p>
        <ul>
          <li><b>A no rendirme</b>, ni con las matemáticas ni con la bici.</li>
          <li><b>A pedir perdón</b>, aunque cueste.</li>
          <li><b>A reírme de mí misma</b>, sobre todo cuando bailas.</li>
        </ul>
        <p style="font-size:22px;text-align:center;color:#d6336c"><b>¡Te quiero muchísimo!</b></p>
        <p style="text-align:right;font-style:italic">Paula</p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('tarta', 'cake', 'Te la guardamos')],
    when: [2, '17:25'],
    expect: { status: 'ASSIGNED', participants: ['javier-moreno'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-maquina-escribir',
    tests: 'Carta «a máquina» en Courier New con separadores, sangría y texto centrado',
    from: from('Íker Sanz', 'iker.sanz'),
    subject: 'Para Nacho, de tu hermano',
    ...rich(
      `<div style="font-family:'Courier New',Courier,monospace;font-size:15px;color:#212121;background-color:#fdf6e3;line-height:1.7">
        <p style="text-align:center;letter-spacing:4px"><b>C A R T A</b></p>
        <hr>
        <p><b>Querido Nacho:</b></p>
        <p style="text-indent:40px">Te escribo con la vieja Olivetti del abuelo, la que estaba en el trastero. Bueno, en realidad con el ordenador y una letra que se le parece, pero déjame que me lo crea.</p>
        <p style="text-indent:40px">Somos hermanos desde hace cuarenta y ocho años y nunca te he escrito una carta. Me cuesta decirte las cosas a la cara, así que aprovecho: gracias por las veces que me cubriste con papá, por prestarme el coche para mi primera cita y por estar en el hospital cuando nació Aitana.</p>
        <p style="text-indent:40px">Me alegro mucho de que te hayas animado a ir. Ojalá vuelvas con la paz que buscas.</p>
        <hr>
        <p style="text-align:right">Tu hermano,<br><b>Íker</b></p>
        <p style="font-size:12px;color:#757575">P. D.: Lo del coche sigo sin contárselo a mamá.</p>
      </div>`,
    ),
    when: [4, '22:10'],
    expect: { status: 'ASSIGNED', participants: ['jose-ignacio-sanz'] },
  },
  {
    id: 'rica-camino',
    tests: 'Letra manuscrita (Segoe Script), cita en color y foto incrustada del Camino',
    from: from('Lucía Sanz', 'lucia.sanz'),
    subject: 'Carta para José Ignacio Sanz',
    ...rich(
      `<div style="font-family:'Segoe Script','Comic Sans MS',cursive;font-size:18px;color:#283593;line-height:1.8">
        <p style="font-size:22px"><b>Querido Nacho:</b></p>
        <p>¿Te acuerdas de nuestro Camino de Santiago, hace quince años? Tú con la mochila de cuarenta litros y yo con la de veinte, y aun así me tocaba esperarte en cada cuesta.</p>
        <p style="text-align:center">${img('camino', 'Flecha amarilla en el Camino')}</p>
        <p>Aquella flecha amarilla en cada cruce me sigue pareciendo la mejor imagen de lo que es la fe: no ves todo el camino, solo el siguiente paso.</p>
        <p style="color:#b5179e;text-align:center;font-size:20px"><i>«Caminante, no hay camino,<br>se hace camino al andar.»</i></p>
        <p>Estos días, solo el siguiente paso. Los niños y yo te esperamos al final de la etapa.</p>
        <p style="text-align:right">Tu Lucía</p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('camino', 'camino', 'Solo el siguiente paso')],
    when: [3, '09:40'],
    expect: { status: 'ASSIGNED', participants: ['jose-ignacio-sanz'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-perro',
    tests: 'Trebuchet con texto resaltado (fondo amarillo), lista con viñetas y foto incrustada',
    from: from('Begoña Serrano', 'begona.serrano.fotos'),
    subject: 'Carta para Hugo Serrano',
    ...rich(
      `<div style="font-family:'Trebuchet MS',Arial,sans-serif;font-size:16px;color:#333;line-height:1.6">
        <p style="color:#0b7285;font-size:20px"><b>Querido Hugo:</b></p>
        <p>Parte diario de la casa, para que estés tranquilo:</p>
        <ul>
          <li>Las niñas: <span style="background-color:#fff3bf">bien, aunque discuten por quién duerme con tu sudadera</span>.</li>
          <li>La lavadora: ha vuelto a hacer el ruido raro. <i>Te espera.</i></li>
          <li>Pipo: deprimido. Mira la puerta cada vez que suena el ascensor.</li>
        </ul>
        <p style="text-align:center">${img('pipo', 'Pipo esperando')}</p>
        <p>Ahora en serio: gracias por este año. Sé lo que te ha costado el cambio de trabajo y lo bien que lo has llevado delante de las niñas. <b style="color:#0b7285">Eres mi mejor compañero de viaje.</b></p>
        <p style="font-style:italic;color:#0b7285">Te quiero,<br>Bego</p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('pipo', 'dog', 'Pipo te espera en la puerta')],
    when: [2, '20:45'],
    expect: { status: 'ASSIGNED', participants: ['hugo-serrano'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-madre-manuscrita',
    tests: 'Carta de una madre en letra manuscrita con colores suaves y foto de familia incrustada',
    from: from('Mercedes Herrera', 'mercedes.herrera'),
    subject: 'Carta para Álvaro Herrera',
    ...rich(
      `<div style="font-family:'Segoe Script','Comic Sans MS',cursive;font-size:17px;color:#5a189a;background-color:#f8f0fb;line-height:1.8">
        <p style="font-size:21px"><b>Querido Álvaro:</b></p>
        <p>Hijo mío, treinta años y para mí sigues siendo el niño que se escondía detrás de mis piernas el primer día de colegio.</p>
        <p style="text-align:center">${img('familia-herrera', 'La familia en el pueblo')}</p>
        <p>Esta foto es del verano pasado en el pueblo. Mírala bien: todos estamos sonriendo porque tú acababas de contar una de las tuyas.</p>
        <p>Rezo cada noche para que encuentres lo que buscas. <span style="color:#c9184a">Y si no lo encuentras, que sepas que aquí siempre tienes tu casa.</span></p>
        <p style="text-align:right">Tu madre que te quiere,<br>Mercedes</p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('familia-herrera', 'family', 'Verano en el pueblo')],
    when: [2, '16:00'],
    expect: { status: 'ASSIGNED', participants: ['alvaro-herrera'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-hermana-viaje',
    tests: 'Trebuchet con subtítulos h2, alineación justificada, lista y foto del mar incrustada',
    from: from('Amaia Ibáñez', 'amaia.ibanez.viaje'),
    subject: 'Carta para Borja Ibáñez',
    ...rich(
      `<div style="font-family:'Trebuchet MS',Arial,sans-serif;font-size:15px;color:#22223b;line-height:1.7">
        <p style="font-size:19px;color:#4a4e69"><b>Querido Borja:</b></p>
        <h2 style="color:#c9ada7;background-color:#22223b;text-align:center">Lo que nos enseñó el mar</h2>
        <p style="text-align:justify">El verano que aita nos llevó a Mundaka a ver surfear, tú tenías ocho años y te empeñaste en meterte con una tabla prestada. Te revolcó la primera ola, la segunda y la décima. A la undécima te pusiste de pie tres segundos y saliste del agua como si hubieras ganado el mundial.</p>
        <p style="text-align:center">${img('mundaka', 'El mar de Mundaka')}</p>
        <h2 style="color:#4a4e69">Por eso sé que…</h2>
        <ul>
          <li>vas a levantarte de lo de este año;</li>
          <li>no hace falta que lo hagas solo;</li>
          <li>y que la próxima ola la cogemos juntos.</li>
        </ul>
        <p style="text-align:right;color:#4a4e69"><i>Tu hermana,<br>Amaia</i></p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('mundaka', 'sea', 'Mundaka, verano del 99')],
    when: [1, '22:30'],
    expect: { status: 'ASSIGNED', participants: ['borja-ibanez'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-padre-montana',
    tests: 'Georgia con tabla de dos columnas, texto en color y foto de montaña incrustada',
    from: from('Jorge Vázquez', 'jorge.vazquez.montana'),
    subject: 'Carta para Iván Vázquez',
    ...rich(
      `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#2d3142;line-height:1.7">
        <p style="color:#bf0603;font-size:20px"><b>Querido Iván:</b></p>
        <p>Cuando eras pequeño, en Mérida, subíamos al teleférico a ver la Sierra Nevada venezolana. Tú te pegabas al cristal y preguntabas qué había detrás de cada montaña.</p>
        <p style="text-align:center">${img('montana', 'Atardecer en la montaña')}</p>
        <table>
          <tr><td style="color:#bf0603;vertical-align:top"><b>Lo que dejaste</b></td><td style="color:#2a9d8f;vertical-align:top"><b>Lo que has encontrado</b></td></tr>
          <tr><td>Tu barrio y tus amigos de siempre</td><td>Una familia nueva en la parroquia</td></tr>
          <tr><td>Un trabajo que no te llenaba</td><td>Un oficio del que estás orgulloso</td></tr>
          <tr><td>La arepa de la abuela</td><td><i>Bueno, esa no tiene sustituto</i></td></tr>
        </table>
        <p>Detrás de cada montaña hay otra, hijo. Pero ya sabes subirlas.</p>
        <p style="text-align:right;color:#bf0603"><i>Te quiere,<br>Papá</i></p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('montana', 'sunset', 'Detrás de cada montaña')],
    when: [2, '08:50'],
    expect: { status: 'ASSIGNED', participants: ['ivan-vazquez'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-esposa-dos-fotos',
    tests: 'Palatino con dos fotos incrustadas entre párrafos, títulos y texto resaltado',
    from: from('Patricia Salas', 'patricia.salas.fotos'),
    subject: 'Carta para Carlos Delgado',
    ...rich(
      `<div style="font-family:'Palatino Linotype','Book Antiqua',Palatino,serif;font-size:16px;color:#3a2e2a;line-height:1.7">
        <h2 style="color:#9c2c2c;text-align:center">Doce años, tres hijos y un camino</h2>
        <p><b style="color:#9c2c2c">Querido Carlos:</b></p>
        <p>Te escribo mientras los niños duermen. He estado mirando fotos y he elegido dos para ti.</p>
        <p style="text-align:center">${img('familia-delgado', 'Los cinco en el parque')}</p>
        <p>La primera es de este verano: los cinco en el parque, tú con la mayor a hombros aunque ya pesa como un saco de patatas. <span style="background-color:#ffe5d9">Así te veo siempre: cargando con todos, sin quejarte.</span></p>
        <p style="text-align:center">${img('camino-delgado', 'El camino del monte')}</p>
        <p>La segunda es del monte al que subimos el día que decidiste apuntarte al retiro. Me dijiste: «No sé qué voy a encontrar, pero quiero ir». Esa frase me la guardo.</p>
        <p style="color:#9c2c2c">Y ni se te ocurra probar nada con frutos secos, que llevas el autoinyector en la mochila pequeña.</p>
        <p style="text-align:right"><i>Te quiero,<br>Patricia</i></p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('familia-delgado', 'family', 'Los cinco'), await inlineImage('camino-delgado', 'camino', 'El día que dijiste que sí')],
    when: [1, '23:15'],
    expect: { status: 'ASSIGNED', participants: ['carlos-delgado'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'rica-hijos-curro',
    tests: 'Carta de niños en Comic Sans con encabezados de colores y dos dibujos incrustados',
    from: from('Los niños Torres', 'ninos.torres'),
    subject: 'Carta para Francisco José Torres',
    ...rich(
      `<div style="font-family:'Comic Sans MS','Chalkboard SE',cursive;font-size:17px;color:#333">
        <h1 style="color:#f77f00;text-align:center">PARA PAPÁ CURRO</h1>
        <p><b style="color:#d62828">Querido Curro:</b> (mamá dice que te llamemos así porque es una carta seria)</p>
        <p>Te echamos de menos. Mamá deja que veamos más dibujos, pero no es lo mismo sin ti en el sofá.</p>
        <p style="text-align:center">${img('dibujo-torres', 'Dibujo de la familia')}</p>
        <h3 style="color:#003049">Lo que ha pasado esta semana:</h3>
        <ul>
          <li style="color:#d62828">Lola ha perdido un diente y el Ratoncito Pérez le ha dejado dos euros.</li>
          <li style="color:#f77f00">Bruno ha marcado un gol (de rebote, pero cuenta).</li>
          <li style="color:#003049">Rufo se ha comido una zapatilla tuya. La izquierda.</li>
        </ul>
        <p style="text-align:center">${img('rufo', 'Rufo, el culpable')}</p>
        <p style="font-size:22px;text-align:center;color:#d62828"><b>¡VUELVE PRONTO!</b></p>
        <p style="text-align:right">Lola, Bruno (y Rufo)</p>
      </div>`,
    ),
    attachments: async () => [await inlineImage('dibujo-torres', 'crayon', 'Nuestra familia'), await inlineImage('rufo', 'dog', 'Rufo pide perdón')],
    when: [3, '19:05'],
    expect: { status: 'ASSIGNED', participants: ['francisco-jose-torres'], flags: ['HAS_ATTACHMENTS'] },
  },
];

/**
 * Resolves the date of a letter: `daysBefore` days before today, at HH:MM in Europe/Madrid.
 * @param {[number, string]} when
 * @param {Date} [now]
 * @returns {Date}
 */
export function resolveDate([daysBefore, time], now = new Date()) {
  const [year, month, day] = toZonedDateKey(now, TIME_ZONE).split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day - daysBefore);
  const date = new Date(midnightUtc);
  return zonedWallClockToInstant(
    { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute },
    TIME_ZONE,
  );
}
