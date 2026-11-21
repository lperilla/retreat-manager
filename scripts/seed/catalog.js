/**
 * Test-letter catalog for `npm run seed:gmail`: fictitious participants and ~50 letters in
 * many formats (plain text, HTML, multipart, Latin-1, emojis, scans, photos, PDF, DOCX,
 * inline cid images, unsupported and blocked files, replies, forwards, auto-replies,
 * newsletters, bounces…). Every letter documents what it tests and the expected result,
 * which test/project/seedCatalog.test.js checks against the real pipeline.
 *
 * Every sender uses the fictitious domain SEED_SENDER_DOMAIN, so the letters can be selected
 * (GMAIL_QUERY=from:familias-prueba.example) and deleted from Gmail with one search.
 */
import { DOCX_MIME } from '../../src/domain/services/attachments.js';
import { toZonedDateKey, zonedWallClockToInstant } from '../../src/domain/services/time.js';
import { buildDocx, buildPdf, buildZip, drawing, fakeHeic, fakeMov, letterImage } from '../lib/fixtures.js';

export const SEED_SENDER_DOMAIN = 'familias-prueba.example';
export const SEED_QUERY = `from:${SEED_SENDER_DOMAIN}`;
const TIME_ZONE = 'Europe/Madrid';

/** Participants matching the letters (written to data/participants.json with --write-participants). */
export const SEED_PARTICIPANTS = Object.freeze([
  { displayName: 'María García', aliases: ['Mari'] },
  { displayName: 'María López', aliases: [] },
  { displayName: 'Juan Martínez', aliases: ['Juanito'] },
  { displayName: 'Ana Belén Torres', aliases: ['Anabel'] },
  { displayName: 'Álvaro Herrera', aliases: [] },
  { displayName: 'Lucía Fernández', aliases: [] },
  { displayName: 'Pablo Ortega', aliases: [] },
  { displayName: 'Pablo Ruiz', aliases: [] },
  { displayName: 'Carmen Delgado', aliases: [] },
  { displayName: 'Javier Moreno', aliases: ['Javi'] },
  { displayName: 'Irene Vázquez', aliases: [] },
  { displayName: 'Diego Navarro', aliases: [] },
  { displayName: 'Nuria Prieto', aliases: [] },
  { displayName: 'Sergio Romero', aliases: [] },
  { displayName: 'Marta Gil', aliases: [] },
  { displayName: 'Hugo Serrano', aliases: [] },
  { displayName: 'Claudia Molina', aliases: [] },
  { displayName: 'José Ignacio Sanz', aliases: ['Nacho'] },
  { displayName: 'Begoña Ibáñez', aliases: [] },
  { displayName: 'Íñigo Ezquerra', aliases: [] },
]);

/**
 * @param {string} name
 * @param {string} local
 */
const from = (name, local) => ({ name, address: `${local}@${SEED_SENDER_DOMAIN}` });

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
  'Hoy hemos pasado la tarde ordenando fotos antiguas en el salón de casa, y entre risas y algún que otro llanto nos hemos acordado de todos los veranos en el pueblo, de las bicis sin frenos, de las noches de tormenta contando los segundos entre el rayo y el trueno y de aquella vez que nos perdimos volviendo del río y acabamos cenando en casa de unos vecinos que no conocíamos de nada. Tu abuelo dice que eso fue lo mejor del verano y tu abuela todavía se enfada cuando se lo recuerda. También hemos encontrado la caja con tus dibujos de cuando eras pequeño, esos que firmabas con letras enormes, y hemos decidido enmarcar uno para el pasillo. Cuando vuelvas te lo enseñamos y nos dices si te gusta o prefieres otro.';

/** @type {SeedLetter[]} */
export const SEED_LETTERS = [
  {
    id: 'asunto-explicito',
    tests: 'Asunto «Carta para Nombre Apellido» en texto plano',
    from: from('Rosa Martín', 'rosa.martin'),
    subject: 'Carta para María García',
    text: 'Querida hija:\n\nDesde que te fuiste la casa está muy silenciosa. Tu hermano pregunta cada noche cuándo vuelves.\n\nAprovecha cada momento y no tengas miedo de abrir el corazón.\n\nTe queremos muchísimo ❤️\n\nUn abrazo enorme,\nMamá',
    when: [6, '09:12'],
    expect: { status: 'ASSIGNED', participants: ['maria-garcia'] },
  },
  {
    id: 'saludo-cuerpo',
    tests: 'Solo el saludo del cuerpo identifica al destinatario («Querido Juan:»)',
    from: from('Pilar Sanz', 'pilar.sanz'),
    subject: 'Ánimo desde Zaragoza',
    text: 'Querido Juan:\n\nTu tía y yo hemos encendido una vela por ti en la parroquia. Nos acordamos de cuando no querías ir de campamento, ¡y mírate ahora!\n\nDisfruta, comparte y descansa. Aquí te esperamos con croquetas.\n\nMuchos besos,\nTía Pilar',
    when: [6, '10:05'],
    expect: { status: 'ASSIGNED', participants: ['juan-martinez'] },
  },
  {
    id: 'alias-asunto',
    tests: 'Alias en el asunto («Para Nacho» → José Ignacio Sanz)',
    from: from('Familia Sanz', 'familia.sanz'),
    subject: 'Para Nacho',
    text: '¡Hola, campeón!\n\nTu hermana ha hecho galletas con forma de estrella para cuando vuelvas. Dice que no te va a dejar ninguna si no le cuentas todo.\n\nUn abrazo muy fuerte de los cuatro.',
    when: [6, '12:30'],
    expect: { status: 'ASSIGNED', participants: ['jose-ignacio-sanz'] },
  },
  {
    id: 'asunto-corchetes',
    tests: 'Asunto con corchetes «[Para: Nombre]»',
    from: from('Jorge Vázquez', 'jorge.vazquez'),
    subject: '[Para: Irene Vázquez] Desde Valencia',
    text: 'Querida Irene:\n\nTe escribimos desde Valencia, donde hace un sol espléndido. Tus primos te mandan recuerdos y dicen que a la vuelta te toca organizar la paella.\n\nUn abrazo de toda la familia.',
    when: [5, '09:00'],
    expect: { status: 'ASSIGNED', participants: ['irene-vazquez'] },
  },
  {
    id: 'mayusculas-sin-tildes',
    tests: 'Asunto en mayúsculas y sin tildes («BEGOÑA IBAÑEZ»)',
    from: from('Amaia Ibáñez', 'amaia.ibanez'),
    subject: 'CARTA PARA BEGOÑA IBAÑEZ',
    text: 'Querida Begoña:\n\nPerdona las mayúsculas del asunto, tu prima me ha cambiado algo en el móvil y no sé quitarlo. Te pensamos mucho estos días.\n\nUn beso grande,\nAmaia',
    when: [5, '10:40'],
    expect: { status: 'ASSIGNED', participants: ['begona-ibanez'] },
  },
  {
    id: 'ambigua-maria',
    tests: 'Nombre de pila compartido por dos participantes («Querida María:») → Por revisar',
    from: from('Familia Blanco', 'familia.blanco'),
    subject: 'Unas líneas para ti',
    text: 'Querida María:\n\nTe escribimos todos juntos desde la mesa de la cocina. Tu primo Andrés ha hecho un dibujo que te guardamos para cuando vuelvas.\n\nCon todo nuestro cariño,\nLa familia',
    when: [5, '11:30'],
    expect: { status: 'NEEDS_REVIEW', suggestions: ['maria-garcia', 'maria-lopez'] },
  },
  {
    id: 'ambigua-pablo',
    tests: 'Otro nombre compartido («Querido Pablo:») → Por revisar',
    from: from('Marisa Gómez', 'marisa.gomez'),
    subject: 'Desde casa',
    text: 'Querido Pablo:\n\nSoy tu catequista. Te escribo para decirte que estoy muy contenta de que hayas dado el paso de ir al retiro. Escucha mucho y disfruta.\n\nUn abrazo grande,\nMarisa',
    when: [5, '13:15'],
    expect: { status: 'NEEDS_REVIEW', suggestions: ['pablo-ortega', 'pablo-ruiz'] },
  },
  {
    id: 'ambigua-resuelta',
    tests: 'Saludo ambiguo resuelto por el nombre completo en el asunto',
    from: from('Carmen Ruiz', 'carmen.ruiz'),
    subject: 'Carta para Pablo Ortega',
    text: 'Querido Pablo:\n\nTe escribo rápido antes de salir a trabajar. Solo quería decirte que estamos contigo y que rezamos por ti cada noche.\n\nUn beso muy fuerte,\nMamá',
    when: [5, '18:45'],
    expect: { status: 'ASSIGNED', participants: ['pablo-ortega'] },
  },
  {
    id: 'varios-asunto',
    tests: 'Carta para dos participantes nombrados en el asunto',
    from: from('Abuela Teresa', 'teresa.fernandez'),
    subject: 'Carta para Juan y Lucía',
    text: 'Queridos sobrinos:\n\nQué alegría saber que estáis juntos en el retiro. Cuidaos el uno al otro como cuando erais pequeños y os escapabais a la huerta a comer fresas.\n\nOs llevo en mis oraciones.\n\nBesos de vuestra abuela,\nTeresa',
    when: [4, '12:00'],
    expect: { status: 'ASSIGNED', participants: ['juan-martinez', 'lucia-fernandez'], flags: ['MULTI_RECIPIENT'] },
  },
  {
    id: 'varios-cuerpo',
    tests: 'Carta para dos participantes nombrados en el saludo del cuerpo',
    from: from('Tíos de Burgos', 'tios.burgos'),
    subject: 'Para los dos',
    text: 'Queridos Diego y Nuria:\n\nNos ha hecho mucha ilusión saber que coincidís en el retiro. Aprovechad para conoceros más y para descansar de tanto examen.\n\nUn abrazo de vuestros tíos.',
    when: [4, '13:20'],
    expect: { status: 'ASSIGNED', participants: ['diego-navarro', 'nuria-prieto'], flags: ['MULTI_RECIPIENT'] },
  },
  {
    id: 'remitente-trampa',
    tests: 'El remitente se llama como otra participante (Lucía Fernández) y firma con su nombre: no debe asignarse a ella',
    from: from('Lucía Fernández', 'lucia.fernandez.tia'),
    subject: 'Ánimo, sobrino',
    text: 'Querido Diego:\n\nTe escribe tu tía desde Granada. Me han dicho que estás muy contento y que has hecho amigos nuevos. Eso es lo más importante.\n\nUn beso,\nLucía Fernández',
    when: [4, '17:05'],
    expect: { status: 'ASSIGNED', participants: ['diego-navarro'] },
  },
  {
    id: 'respuesta-citada',
    tests: 'Respuesta que cita otro correo que nombra a otra participante (la cita se ignora)',
    from: from('Luis Romero', 'luis.romero'),
    subject: 'Re: Cartas para el retiro',
    text: 'Querido Sergio:\n\nAquí va mi carta, como pedían desde la organización. Estoy muy contento de que hayas decidido ir.\n\nCuando vuelvas, nos vamos tú y yo a pescar 🎣\n\nTe quiere,\nPapá\n\nEl lun, 16 nov 2026 a las 21:04, Coordinación Retiro <coordinacion@familias-prueba.example> escribió:\n> Queridas familias:\n> Recordad que el plazo para escribir a Marta Gil y al resto del grupo termina el jueves.\n> Un saludo,\n> Coordinación',
    when: [4, '08:20'],
    expect: { status: 'ASSIGNED', participants: ['sergio-romero'] },
  },
  {
    id: 'reenviado',
    tests: 'Carta reenviada: se ignoran las cabeceras del reenvío y se lee la carta de dentro',
    from: from('Andrea Prieto', 'andrea.prieto'),
    subject: 'Fwd: carta de la abuela',
    text: 'Te reenvío la carta de la abuela, que no sabe usar el correo del retiro.\n\n---------- Forwarded message ---------\nDe: Abuela Carmen <abuela.carmen@familias-prueba.example>\nDate: dom, 15 nov 2026, 19:00\nSubject: Para Nuria\nTo: andrea.prieto@familias-prueba.example\n\nQuerida Nuria:\n\nEstoy muy orgullosa de ti. Reza un poquito por tu abuela, que yo rezo mucho por ti.\n\nTu abuela Carmen',
    when: [4, '19:30'],
    expect: { status: 'ASSIGNED', participants: ['nuria-prieto'] },
  },
  {
    id: 'cita-outlook',
    tests: 'Respuesta de Outlook con bloque «De/Enviado/Para/Asunto» que menciona a otra participante',
    from: from('Begoña Serrano', 'begona.serrano'),
    subject: 'RE: Carta',
    text: 'Hola Hugo,\n\nTe escribo en el descanso del trabajo. Papá y yo estamos deseando que nos cuentes todo. ¡Disfruta mucho!\n\nUn beso,\nMamá\n\n________________________________\nDe: Coordinación Retiro <coordinacion@familias-prueba.example>\nEnviado: lunes, 16 de noviembre de 2026 21:04\nPara: Familias\nAsunto: Cartas\n\nRecordad que todavía nadie ha escrito a Claudia Molina.',
    when: [3, '10:10'],
    expect: { status: 'ASSIGNED', participants: ['hugo-serrano'] },
  },
  {
    id: 'solo-html',
    tests: 'Correo solo en HTML con estilos, un <script> y una imagen remota de seguimiento (se convierten a texto limpio)',
    from: from('Familia Gil', 'familia.gil'),
    subject: 'Para Marta',
    html: '<html><head><style>p{color:#333;font-family:Arial}</style></head><body><div style="font-size:15px">Querida Marta:</div><div><br></div><p>Te hemos preparado una <b>sorpresa</b> para cuando vuelvas. No te podemos decir nada más &#128521;</p><ul><li>Pista 1: es grande</li><li>Pista 2: hace ruido</li></ul><p>Te queremos,<br>Tus padres</p><script>alert("hola")</script><img src="https://tracker.example/pixel.gif" width="1" height="1"></body></html>',
    when: [3, '11:45'],
    expect: { status: 'ASSIGNED', participants: ['marta-gil'] },
  },
  {
    id: 'texto-y-html',
    tests: 'multipart/alternative (texto + HTML): se usa la versión de texto',
    from: from('Manuel Herrera', 'manuel.herrera'),
    subject: 'Carta para Álvaro',
    text: 'Querido hijo:\n\nEsta mañana, desayunando, tu madre y yo hablábamos de lo rápido que pasa el tiempo. Parece que fue ayer cuando te enseñé a montar en bici.\n\nUn abrazo fuerte,\nPapá',
    html: '<p>Querido hijo:</p><p>Esta mañana, desayunando, tu madre y yo hablábamos de lo rápido que pasa el tiempo. Parece que fue ayer cuando te enseñé a montar en bici.</p><p>Un abrazo fuerte,<br>Papá</p>',
    when: [3, '12:30'],
    expect: { status: 'ASSIGNED', participants: ['alvaro-herrera'] },
  },
  {
    id: 'latin1',
    tests: 'Texto en codificación ISO-8859-1 (tildes y ñ deben verse bien)',
    from: from('Abuela Pilar', 'abuela.pilar'),
    subject: 'Carta para Begoña',
    text: 'Querida Begoña:\n\nTu abuela te escribe desde el ordenador viejo del abuelo. Este año has crecido muchísimo, niña. Mañana hago tu bizcocho de limón para cuando vuelvas.\n\nUn beso muy grande,\nLa abuela',
    textCharset: 'iso-8859-1',
    when: [3, '16:00'],
    expect: { status: 'ASSIGNED', participants: ['begona-ibanez'] },
  },
  {
    id: 'emojis',
    tests: 'Asunto y cuerpo llenos de emojis',
    from: from('Prima Sofía', 'sofia.fernandez'),
    subject: '🌟 Para Lucía 🌟',
    text: '¡¡Luuuucía!! 🥳🥳\n\nTe echo muchísimo de menos 😭 El perro está triste 🐶 y mamá no deja de mirar tus fotos 📸\n\nCuando vuelvas, maratón de pelis 🍿🎬\n\nTe quiero muchísimo 💖✨',
    when: [3, '18:20'],
    expect: { status: 'ASSIGNED', participants: ['lucia-fernandez'] },
  },
  {
    id: 'medianoche-antes',
    tests: 'Recibida a las 23:50 (hora de Madrid): agrupación por día y filtro de fecha',
    from: from('Javier Fernández', 'javier.fdez'),
    subject: 'Carta para Lucía Fernández',
    text: 'Querida Lucía:\n\nEs casi medianoche y no podía irme a dormir sin escribirte. Hoy he pasado por delante de tu colegio y me he acordado de lo nerviosa que estabas el primer día.\n\nHas crecido mucho, hija. Confío en ti.\n\nBuenas noches y un abrazo,\nPapá',
    when: [3, '23:50'],
    expect: { status: 'ASSIGNED', participants: ['lucia-fernandez'] },
  },
  {
    id: 'medianoche-despues',
    tests: 'Recibida a las 00:10 del día siguiente (hora de Madrid)',
    from: from('Marisa Catequista', 'marisa.catequista'),
    subject: 'Buenas noches',
    text: '¡Hola, Lucía!\n\nSoy Marisa. Te escribo ya pasada la medianoche porque acabo de salir del turno del hospital. Recuerda lo que hablamos: no tienes que tener todas las respuestas.\n\nUn abrazo grande,\nMarisa',
    when: [2, '00:10'],
    expect: { status: 'ASSIGNED', participants: ['lucia-fernandez'] },
  },
  {
    id: 'nombre-completo-cuerpo',
    tests: 'Saludo con nombre y apellido en el cuerpo («Querido Pablo Ortega:»)',
    from: from('Padrino Andrés', 'andres.padrino'),
    subject: 'Desde Sevilla',
    text: 'Querido Pablo Ortega:\n\nSí, te pongo el apellido porque me han dicho que hay dos Pablos en el grupo y no quiero que mi carta acabe en manos equivocadas 😉\n\nTu padrino está muy orgulloso de ti.\n\nUn abrazo,\nAndrés',
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
    tests: 'Boletín masivo (List-Unsubscribe, Precedence: bulk) → aviso «Envío masivo», Por revisar',
    from: from('Parroquia San Miguel', 'boletin.parroquia'),
    subject: 'Boletín semanal de la parroquia',
    headers: { 'List-Unsubscribe': '<mailto:baja@familias-prueba.example>', Precedence: 'bulk', 'List-Id': 'Boletin <boletin.familias-prueba.example>' },
    html: '<h1>Boletín semanal</h1><p>Hola a todos:</p><p>Esta semana celebramos el retiro de jóvenes. Os pedimos oraciones por los chicos y por los monitores. El domingo habrá chocolate con churros a la salida de misa.</p><p><a href="https://example.org/baja">Darse de baja</a></p>',
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
          ['Querido Íñigo:', '', 'Como no sabíamos escribir en el ordenador,', 'te mandamos la carta escaneada.', '', 'Estamos muy contentos de que hayas ido.', 'El perro te busca por toda la casa.', '', 'Te queremos muchísimo.', '', 'Papá, mamá y Ane'],
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
    text: 'Hola, cariño:\n\nTe mando escaneada la carta que te ha escrito la abuela a mano, que ya sabes que ella no se apaña con el ordenador. Va en el archivo adjunto.\n\nBesos,\nMamá',
    attachments: async () => [
      {
        filename: 'carta-abuela.jpg',
        mimeType: 'image/jpeg',
        data: await letterImage(
          ['Querido Javi:', '', 'Tu madre me ha dicho que estás de retiro', 'y no he querido dejar pasar la ocasión.', '', 'Me acuerdo de cuando venías a merendar', 'pan con chocolate. ¡Cuánto has crecido!', '', 'Aquí te espero con un abrazo muy fuerte.', '', 'Tu abuela Maruja'],
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
    subject: 'Carta para Carmen Delgado',
    text: 'Querida Carmen:\n\nTe adjunto la carta en PDF porque la he escrito con calma en el ordenador y quería que te llegara bien maquetada.\n\nTe queremos mucho.\n\nPapá y mamá',
    attachments: async () => [
      {
        filename: 'Carta para Carmen.pdf',
        mimeType: 'application/pdf',
        data: buildPdf(['Querida Carmen:', '', 'Este verano fue precioso: la playa, las bicis, las noches de estrellas.', 'Estamos muy orgullosos de la persona en la que te estás convirtiendo.', '', 'Te queremos mucho.', '', 'Papá y mamá']),
      },
    ],
    when: [1, '11:05'],
    expect: { status: 'ASSIGNED', participants: ['carmen-delgado'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'docx-con-texto',
    tests: 'Carta en Word (.docx) con unas líneas en el cuerpo: el texto del Word se muestra dentro de la carta',
    from: from('Begoña Navarro', 'begona.navarro'),
    subject: 'Para Diego',
    text: 'Hola Diego:\n\nTe envío la carta en un documento de Word, que es donde la he ido escribiendo estos días poco a poco.\n\n¡Mucho ánimo, campeón!',
    attachments: async () => [
      {
        filename: 'Carta Diego.docx',
        mimeType: DOCX_MIME,
        data: buildDocx(['Querido Diego:', '', 'Llevo varios días escribiendo esta carta a ratos, entre clase y clase.', 'Eres el mejor hermano que podría tener, aunque nos peleemos por el mando de la tele.', '', 'Un abrazo enorme,', 'Begoña']),
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
        data: buildDocx(['Querido Sergio:', '', 'Te escribo desde la oficina en un rato libre.', 'Estamos muy orgullosos de ti y de cómo has crecido este año.', '', 'Cuando vuelvas, vamos al partido.', '', 'Papá']),
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
    text: 'Querida Mari:\n\nToby no deja de buscarte por toda la casa. Aquí lo tienes:\n\n[cid:toby@familias-prueba.example]\n\nTe echo muchísimo de menos.\n\nTe quiero,\nClara',
    html: '<p>Querida Mari:</p><p>Toby no deja de buscarte por toda la casa. Aquí lo tienes:</p><p><img src="cid:toby@familias-prueba.example" alt="Toby"></p><p>Te echo muchísimo de menos.</p><p>Te quiero,<br>Clara</p>',
    attachments: async () => [{ filename: 'toby.png', mimeType: 'image/png', data: await drawing('Toby te echa de menos'), contentId: 'toby@familias-prueba.example' }],
    when: [1, '16:30'],
    expect: { status: 'ASSIGNED', participants: ['maria-garcia'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'foto-webp',
    tests: 'Foto adjunta en formato WEBP',
    from: from('Jorge Vázquez', 'jorge.vazquez.papa'),
    subject: 'Carta para Irene',
    text: 'Querida Irene:\n\nTe mandamos una foto de la última excursión para que te acuerdes de nosotros. ¡Qué bien lo pasamos!\n\nUn abrazo de los tres.',
    attachments: async () => [{ filename: 'excursion.webp', mimeType: 'image/webp', data: await letterImage(['Excursión a la sierra', '', '¡Te echamos de menos, Irene!'], { format: 'webp', height: 700 }) }],
    when: [1, '17:10'],
    expect: { status: 'ASSIGNED', participants: ['irene-vazquez'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'gif',
    tests: 'Imagen GIF adjunta',
    from: from('Hermana Laura', 'laura.serrano'),
    subject: 'Para Hugo',
    text: 'Querido Hugo:\n\nTe he hecho un dibujo con el ordenador. Ya sé que no es una obra de arte, pero está hecho con mucho cariño.\n\nTu hermana Laura',
    attachments: async () => [{ filename: 'dibujo.gif', mimeType: 'image/gif', data: await letterImage(['Para Hugo', '', 'De tu hermana que te quiere'], { format: 'gif', width: 800, height: 600 }) }],
    when: [1, '18:00'],
    expect: { status: 'ASSIGNED', participants: ['hugo-serrano'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'heic',
    tests: 'Foto HEIC de iPhone (el sharp estándar no la convierte: se ofrece descargar el original)',
    from: from('Andrea Prieto', 'andrea.prieto.mama'),
    subject: 'Carta para Nuria',
    text: 'Querida Nuria:\n\nTe mando una foto que te hicimos en el cumpleaños del abuelo. La he sacado con el iPhone, espero que se vea bien.\n\nUn beso enorme,\nMamá',
    attachments: async () => [{ filename: 'IMG_1234.HEIC', mimeType: 'image/heic', data: fakeHeic() }],
    when: [1, '19:15'],
    expect: { status: 'ASSIGNED', participants: ['nuria-prieto'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'video',
    tests: 'Vídeo adjunto (.mov): «Adjunto no imprimible» con descarga',
    from: from('Familia Gil', 'familia.gil.video'),
    subject: 'Carta para Marta Gil',
    text: 'Querida Marta:\n\nComo nos dijiste que te encantaría oírnos, te hemos grabado un vídeo todos juntos, hasta el abuelo.\n\nTe queremos.\n\nTus padres y tus hermanos',
    attachments: async () => [{ filename: 'video-familia.mov', mimeType: 'video/quicktime', data: fakeMov() }],
    when: [1, '20:00'],
    expect: { status: 'ASSIGNED', participants: ['marta-gil'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'zip',
    tests: 'Archivo comprimido (.zip): «Adjunto no imprimible» con descarga',
    from: from('Manuel Herrera', 'manuel.herrera.fotos'),
    subject: 'Carta para Álvaro',
    text: 'Querido Álvaro:\n\nTe mando en un zip las fotos del campamento de verano, que pesaban mucho para mandarlas sueltas.\n\nUn abrazo,\nPapá',
    attachments: async () => [{ filename: 'fotos-campamento.zip', mimeType: 'application/zip', data: buildZip([{ name: 'leeme.txt', data: 'Fotos del campamento de verano' }]) }],
    when: [1, '20:40'],
    expect: { status: 'ASSIGNED', participants: ['alvaro-herrera'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'svg-bloqueado',
    tests: 'Adjunto SVG: bloqueado por seguridad (ni se procesa ni se descarga)',
    from: from('Primo Rubén', 'ruben.martinez'),
    subject: 'Carta para Juan',
    text: 'Querido Juan:\n\nTe mando un dibujo que he hecho con el ordenador del cole. Espero que te guste mucho.\n\nTu primo Rubén',
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
    subject: 'Carta para Anabel',
    text: 'Querida Anabel:\n\nTe adjunto la foto que me pediste, aunque el móvil hizo algo raro al guardarla. Si no se ve, ya te la enseño en casa.\n\nRocío',
    attachments: async () => [{ filename: 'foto.png', mimeType: 'image/png', data: Buffer.from('Esto no es una imagen PNG, es un archivo de texto renombrado.\n') }],
    when: [1, '21:45'],
    expect: { status: 'ASSIGNED', participants: ['ana-belen-torres'], flags: ['HAS_ATTACHMENTS'] },
  },
  {
    id: 'solo-mencion',
    tests: 'Solo se menciona el nombre completo, sin saludo → Por revisar con sugerencia',
    from: from('Grupo de oración', 'grupo.oracion'),
    subject: 'Pensando en vosotros',
    text: 'Esta semana el grupo de oración de los martes ha rezado mucho por Claudia Molina y por todo su grupo del retiro. Os mandamos mucha fuerza y alegría.\n\nUn saludo cariñoso.',
    when: [1, '08:30'],
    expect: { status: 'NEEDS_REVIEW', suggestions: ['claudia-molina'] },
  },
  {
    id: 'saludo-tardio',
    tests: 'El saludo está después de un párrafo muy largo (fuera de los primeros 600 caracteres) → Por revisar',
    from: from('Abuelos de Hugo', 'abuelos.serrano'),
    subject: 'Recuerdos del pueblo',
    text: `${LONG_INTRO}\n\nQuerido Hugo:\n\nTe queremos mucho y te esperamos con los brazos abiertos.\n\nTus abuelos`,
    when: [1, '09:45'],
    expect: { status: 'NEEDS_REVIEW', suggestions: [] },
  },
  {
    id: 'no-participante',
    tests: 'Saludo a alguien que no está en la lista de participantes → Por revisar sin sugerencias',
    from: from('Familia Pérez', 'familia.perez'),
    subject: 'Ánimo',
    text: 'Querido Andrés:\n\nEsperamos que estés pasando unos días estupendos. Aquí todos bien, deseando que vuelvas para contárnoslo todo.\n\nUn abrazo de toda la familia.',
    when: [1, '10:20'],
    expect: { status: 'NEEDS_REVIEW', suggestions: [] },
  },
  {
    id: 'saludo-alias-linea',
    tests: 'Asunto vacío y saludo con alias en una línea («Juanito:»)',
    from: from('Abuelo Ramón', 'ramon.martinez'),
    subject: '',
    text: 'Juanito:\n\nTu abuela y yo ya no estamos para muchos viajes, pero te acompañamos desde aquí con el pensamiento. Escucha mucho y habla poco, que así se aprende.\n\nUn abrazo muy grande,\nEl abuelo Ramón',
    when: [1, '11:40'],
    expect: { status: 'ASSIGNED', participants: ['juan-martinez'] },
  },
  {
    id: 'buenos-dias',
    tests: 'Saludo «Buenos días Nombre,»',
    from: from('Tía Elena', 'elena.romero'),
    subject: 'Un saludo',
    text: 'Buenos días Sergio,\n\nTu tía Elena te manda muchos ánimos desde Bilbao. Me han dicho que el sitio del retiro es precioso y que coméis de maravilla.\n\nUn beso fuerte,\nElena',
    when: [1, '12:10'],
    expect: { status: 'ASSIGNED', participants: ['sergio-romero'] },
  },
  {
    id: 'cabecera-para',
    tests: 'Cuerpo que empieza con «Para: Nombre» y «De: …» (no es una cita)',
    from: from('Tía Puri', 'puri.gil'),
    subject: 'Carta',
    text: 'Para: Marta Gil\nDe: tu tía Puri\n\nQuerida sobrina:\n\nTe escribo con letra grande para que no te cueste leerla. Pórtate bien, ayuda en lo que puedas y, sobre todo, disfruta.\n\nTu tía que te quiere',
    when: [1, '13:00'],
    expect: { status: 'ASSIGNED', participants: ['marta-gil'] },
  },
  {
    id: 'html-tabla',
    tests: 'HTML con tablas (estilo Outlook)',
    from: from('Tomás Delgado', 'tomas.delgado.tabla'),
    subject: 'Recuerdos',
    html: '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-family:Calibri">Querida Carmen:</td></tr><tr><td>&nbsp;</td></tr><tr><td>Te escribimos desde el ordenador de papá, que ha puesto letra grande. Aquí estamos todos bien y deseando verte.</td></tr><tr><td>&nbsp;</td></tr><tr><td>Un beso,<br>Mamá</td></tr></table>',
    when: [1, '14:30'],
    expect: { status: 'ASSIGNED', participants: ['carmen-delgado'] },
  },
  {
    id: 'mi-querida-alias',
    tests: 'Saludo «Mi querida» con alias y coma',
    from: from('Madrina Lola', 'lola.ramos'),
    subject: 'Desde Córdoba',
    text: 'Mi querida Anabel, ¿qué tal estás?\n\nTu madrina te manda un abrazo enorme desde Córdoba. Me han dicho que el sitio es precioso, ¡aprovecha!\n\nTe quiero mucho, mi niña.\n\nLola',
    when: [1, '15:40'],
    expect: { status: 'ASSIGNED', participants: ['ana-belen-torres'] },
  },
  {
    id: 'maria-lopez',
    tests: 'Nombre compartido desambiguado por el apellido en el saludo',
    from: from('Ernesto López', 'ernesto.lopez'),
    subject: 'De tu padre',
    text: 'Querida María López:\n\nTe pongo el apellido porque me han dicho que hay dos Marías en el grupo 😉\n\nEstamos muy orgullosos de ti. Disfruta de cada momento.\n\nUn abrazo,\nPapá',
    when: [1, '17:50'],
    expect: { status: 'ASSIGNED', participants: ['maria-lopez'] },
  },
  {
    id: 'pablo-ruiz',
    tests: 'El otro Pablo, identificado por el asunto',
    from: from('Familia Ruiz', 'familia.ruiz'),
    subject: 'Carta para Pablo Ruiz',
    text: 'Querido Pablo:\n\nAquí en casa todos bien. Tu hermano pequeño ha aprendido a silbar y quiere enseñártelo en cuanto vuelvas.\n\nUn beso de todos,\nMamá',
    when: [1, '19:30'],
    expect: { status: 'ASSIGNED', participants: ['pablo-ruiz'] },
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
