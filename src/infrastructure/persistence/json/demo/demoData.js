/**
 * Deterministic demo dataset (realistic Spanish letters). Released in three waves by
 * DemoMailSource so every "Sincronizar ahora" shows new letters.
 *
 * Wave 1 (initial load, 23 letters, 3 for review):
 * - 18 participants; Raúl Domínguez, Hugo Serrano and Claudia Molina have 0 letters (tie at 0).
 * - Lucía Fernández and Pablo Ortega tie for most letters (3 each).
 * - multi-recipient letter ("Carta para Lucía y Pablo"), auto-reply (flagged, still counted),
 *   signature-only letter, attachment-only letter, ambiguous "Querida María:" (two Marías).
 * - letters straddling midnight in Europe/Madrid (23:50 / 00:10).
 * - subject "Carta para María García" and a body-only "Querido Juan:" letter.
 * - a letter whose SENDER is a participant (Carmen Ruiz) written to Pablo (must not assign to Carmen).
 * - a quoted reply mentioning another participant (Marta Gil) that must be ignored.
 * - JPEG scan, PDF, DOCX and an unsupported attachment (.mov).
 * Wave 2: 4 letters, one for Hugo Serrano (previously 0 letters).
 * Wave 3: 3 letters and the deletion of the signature-only letter.
 */

/** Mailbox that receives the letters. */
export const DEMO_MAILBOX = 'Cartas Retiro <cartas.retiro@example.com>';

export const DEMO_PARTICIPANTS = Object.freeze([
  { id: 'maria-garcia', displayName: 'María García', aliases: ['Mari'] },
  { id: 'maria-lopez', displayName: 'María López', aliases: [] },
  { id: 'juan-martinez', displayName: 'Juan Martínez', aliases: ['Juanito'] },
  { id: 'lucia-fernandez', displayName: 'Lucía Fernández', aliases: [] },
  { id: 'pablo-ortega', displayName: 'Pablo Ortega', aliases: [] },
  { id: 'carmen-ruiz', displayName: 'Carmen Ruiz', aliases: [] },
  { id: 'javier-moreno', displayName: 'Javier Moreno', aliases: ['Javi'] },
  { id: 'ana-belen-torres', displayName: 'Ana Belén Torres', aliases: ['Anabel'] },
  { id: 'diego-navarro', displayName: 'Diego Navarro', aliases: [] },
  { id: 'elena-castillo', displayName: 'Elena Castillo', aliases: [] },
  { id: 'sergio-romero', displayName: 'Sergio Romero', aliases: [] },
  { id: 'marta-gil', displayName: 'Marta Gil', aliases: [] },
  { id: 'alvaro-herrera', displayName: 'Álvaro Herrera', aliases: [] },
  { id: 'irene-vazquez', displayName: 'Irene Vázquez', aliases: [] },
  { id: 'raul-dominguez', displayName: 'Raúl Domínguez', aliases: [] },
  { id: 'nuria-prieto', displayName: 'Nuria Prieto', aliases: [] },
  { id: 'hugo-serrano', displayName: 'Hugo Serrano', aliases: [] },
  { id: 'claudia-molina', displayName: 'Claudia Molina', aliases: [] },
]);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * @typedef {Object} DemoMessageInput
 * @property {string} id
 * @property {string} receivedAt  ISO instant (UTC).
 * @property {string} from
 * @property {string} subject
 * @property {string[]} body      Lines (joined with "\n").
 * @property {Array<{ filename: string, mimeType: string, size: number, contentId?: string }>} [attachments]
 * @property {Record<string, string>} [headers]
 */

/**
 * Demo attachment files (src/infrastructure/persistence/json/demo/assets/), by attachmentId.
 * Regenerate them with `node scripts/generate-demo-assets.js`.
 */
export const DEMO_ATTACHMENT_ASSETS = Object.freeze({
  'demo-w1-11-att-1': 'escaneo-raul.jpg',
  'demo-w1-12-att-1': 'carta-abuela.jpg',
  'demo-w1-13-att-1': 'carta-para-elena.pdf',
  'demo-w1-14-att-1': 'carta-diego.docx',
  'demo-w1-15-att-1': 'video-familia.mov',
  'demo-w1-23-att-1': 'perro.png',
});

/**
 * @param {DemoMessageInput} input
 * @returns {import('../../../../application/ports/MailSourcePort.js').IncomingMessage}
 */
function message({ id, receivedAt, from, subject, body, attachments = [], headers = {} }) {
  return Object.freeze({
    messageId: id,
    threadId: `thread-${id}`,
    from,
    to: DEMO_MAILBOX,
    subject,
    receivedAt: new Date(receivedAt),
    body: body.join('\n'),
    attachments: attachments.map((attachment, index) =>
      Object.freeze({ ...attachment, contentId: attachment.contentId ?? null, attachmentId: `${id}-att-${index + 1}` }),
    ),
    headers: Object.freeze({ From: from, To: DEMO_MAILBOX, Subject: subject, ...headers }),
  });
}

const WAVE_1 = [
  message({
    id: 'demo-w1-01',
    receivedAt: '2026-11-17T09:12:00Z',
    from: 'Rosa Martín <rosa.martin.familia@example.com>',
    subject: 'Carta para María García',
    body: [
      'Querida hija:',
      '',
      'Desde que te fuiste el viernes la casa está muy silenciosa. Tu hermano pregunta cada noche cuándo vuelves y la perra se tumba en tu cama como si te esperara.',
      '',
      'Queremos que sepas que estamos muy orgullosos de ti. Aprovecha cada momento, escucha mucho y no tengas miedo de abrir el corazón.',
      '',
      'Te queremos muchísimo ❤️',
      '',
      'Un abrazo enorme,',
      'Mamá',
    ],
  }),
  message({
    id: 'demo-w1-02',
    receivedAt: '2026-11-17T10:05:00Z',
    from: 'Pilar Sanz <pilar.sanz@example.com>',
    subject: 'Ánimo desde Zaragoza',
    body: [
      'Querido Juan:',
      '',
      'Tu abuela y yo hemos encendido una vela por ti en la parroquia. Nos acordamos de cuando eras pequeño y no querías ir de campamento, ¡y mírate ahora!',
      '',
      'Disfruta, comparte y descansa. Aquí te esperamos con croquetas.',
      '',
      'Muchos besos,',
      'Tía Pilar',
    ],
  }),
  message({
    id: 'demo-w1-03',
    receivedAt: '2026-11-17T11:30:00Z',
    from: 'Familia Blanco <familiablanco@example.com>',
    subject: 'Unas líneas para ti',
    body: [
      'Querida María:',
      '',
      'Te escribimos todos juntos desde la mesa de la cocina. Tu primo Andrés ha hecho un dibujo que te guardamos para cuando vuelvas.',
      '',
      'Te pensamos mucho estos días. Ojalá te esté sirviendo para encontrar paz y alegría.',
      '',
      'Con todo nuestro cariño,',
      'La familia',
    ],
  }),
  message({
    id: 'demo-w1-04',
    receivedAt: '2026-11-17T18:45:00Z',
    from: 'Carmen Ruiz <carmen.ruiz.mama@example.com>',
    subject: 'Desde casa',
    body: [
      'Querido Pablo:',
      '',
      'Te escribo rápido antes de salir a trabajar. Solo quería decirte que estamos contigo y que rezamos por ti cada noche.',
      '',
      'Pórtate bien, ayuda en lo que puedas y, sobre todo, disfruta.',
      '',
      'Un beso muy fuerte,',
      'Carmen Ruiz',
    ],
  }),
  message({
    id: 'demo-w1-05',
    receivedAt: '2026-11-18T08:20:00Z',
    from: 'Luis Romero <luis.romero@example.com>',
    subject: 'Re: Cartas para el retiro',
    body: [
      'Querido Sergio:',
      '',
      'Aquí va mi carta, como pedían desde la organización. Estoy muy contento de que hayas decidido ir; sé que al principio te costó.',
      '',
      'Vive estos días con intensidad. Cuando vuelvas, nos vamos tú y yo a pescar como el verano pasado 🎣',
      '',
      'Te quiere,',
      'Papá',
      '',
      'El mar, 17 nov 2026 a las 21:04, Coordinación Retiro <cartas.retiro@example.com> escribió:',
      '> Queridas familias:',
      '> Recordad que el plazo para enviar cartas a Marta Gil y al resto del grupo termina el jueves.',
      '> Un saludo,',
      '> Coordinación',
    ],
  }),
  message({
    id: 'demo-w1-06',
    receivedAt: '2026-11-18T12:00:00Z',
    from: 'Abuela Teresa <teresa.fernandez@example.com>',
    subject: 'Carta para Lucía y Pablo',
    body: [
      'Queridos nietos:',
      '',
      'Qué alegría saber que estáis juntos en el retiro. Cuidaos el uno al otro como cuando erais pequeños y os escapabais a la huerta a comer fresas.',
      '',
      'Os llevo en mis oraciones. Volved con muchas cosas que contarme 😊',
      '',
      'Besos de vuestra abuela,',
      'Teresa',
    ],
  }),
  message({
    id: 'demo-w1-07',
    receivedAt: '2026-11-18T22:50:00Z',
    from: 'Javier Fernández <javier.fdez@example.com>',
    subject: 'Carta para Lucía Fernández',
    body: [
      'Querida Lucía:',
      '',
      'Es casi medianoche y no podía irme a dormir sin escribirte. Hoy he pasado por delante de tu colegio y me he acordado de lo nerviosa que estabas el primer día.',
      '',
      'Has crecido mucho, hija. Confío en ti.',
      '',
      'Buenas noches y un abrazo,',
      'Papá',
    ],
  }),
  message({
    id: 'demo-w1-08',
    receivedAt: '2026-11-18T23:10:00Z',
    from: 'Marisa Gómez <marisa.gomez@example.com>',
    subject: 'Para Lucía',
    body: [
      '¡Hola, Lucía!',
      '',
      'Soy Marisa, tu catequista. Te escribo ya pasada la medianoche porque acabo de salir del turno del hospital.',
      '',
      'Recuerda lo que hablamos: no tienes que tener todas las respuestas, solo dejarte sorprender.',
      '',
      'Un abrazo grande,',
      'Marisa',
    ],
  }),
  message({
    id: 'demo-w1-09',
    receivedAt: '2026-11-18T15:31:00Z',
    from: 'Antonio Ortega <antonio.ortega@empresa-ejemplo.com>',
    subject: 'Respuesta automática: Carta para Pablo Ortega',
    headers: { 'Auto-Submitted': 'auto-replied', 'X-Autoreply': 'yes' },
    body: [
      'Gracias por su mensaje.',
      '',
      'Me encuentro fuera de la oficina hasta el lunes 24 de noviembre, con acceso limitado al correo. Si el asunto es urgente, contacte con recepción en el 900 000 000.',
      '',
      'Un saludo,',
      'Antonio Ortega',
      'Departamento de Compras',
    ],
  }),
  message({
    id: 'demo-w1-10',
    receivedAt: '2026-11-19T07:02:00Z',
    from: 'Rafa Prieto <rafa.prieto@example.com>',
    subject: '',
    body: ['', '', 'Enviado desde mi iPhone'],
  }),
  message({
    id: 'demo-w1-11',
    receivedAt: '2026-11-19T08:15:00Z',
    from: 'Familia Domínguez <fam.dominguez@example.com>',
    subject: 'Escaneo',
    body: [''],
    attachments: [{ filename: 'IMG_20261118_204512.jpg', mimeType: 'image/jpeg', size: 130014 }],
  }),
  message({
    id: 'demo-w1-12',
    receivedAt: '2026-11-19T09:40:00Z',
    from: 'Inés Moreno <ines.moreno@example.com>',
    subject: 'Carta para Javi',
    body: [
      'Hola, cariño:',
      '',
      'Te mando escaneada la carta que te ha escrito la abuela a mano, que ya sabes que ella no se apaña con el ordenador. Va en el archivo adjunto.',
      '',
      'Nosotros estamos bien. Disfruta muchísimo.',
      '',
      'Besos,',
      'Mamá',
    ],
    attachments: [{ filename: 'carta-abuela.jpg', mimeType: 'image/jpeg', size: 162329 }],
  }),
  message({
    id: 'demo-w1-13',
    receivedAt: '2026-11-19T11:05:00Z',
    from: 'Tomás Castillo <tomas.castillo@example.com>',
    subject: 'Carta para Elena Castillo',
    body: [
      'Querida Elena:',
      '',
      'Te adjunto la carta en PDF porque la he escrito con calma en el ordenador y quería que te llegara bien maquetada, con las fotos del verano.',
      '',
      'Te queremos mucho.',
      '',
      'Papá y mamá',
    ],
    attachments: [{ filename: 'carta-para-elena.pdf', mimeType: 'application/pdf', size: 1075 }],
  }),
  message({
    id: 'demo-w1-14',
    receivedAt: '2026-11-19T13:22:00Z',
    from: 'Begoña Navarro <begona.navarro@example.com>',
    subject: 'Para Diego',
    body: [
      'Hola Diego:',
      '',
      'Te envío la carta en un documento de Word, que es donde la he ido escribiendo estos días poco a poco.',
      '',
      '¡Mucho ánimo, campeón!',
      '',
      'Tu hermana Begoña',
    ],
    attachments: [{ filename: 'Carta Diego.docx', mimeType: DOCX_MIME, size: 1934 }],
  }),
  message({
    id: 'demo-w1-15',
    receivedAt: '2026-11-19T16:48:00Z',
    from: 'Familia Gil <familia.gil@example.com>',
    subject: 'Carta para Marta Gil',
    body: [
      'Querida Marta:',
      '',
      'Como nos dijiste que te encantaría oírnos, te hemos grabado un vídeo todos juntos, hasta el abuelo. Esperamos que puedas verlo cuando volváis.',
      '',
      'Te queremos.',
      '',
      'Tus padres y tus hermanos',
    ],
    attachments: [{ filename: 'video-familia.mov', mimeType: 'video/quicktime', size: 2068 }],
  }),
  message({
    id: 'demo-w1-16',
    receivedAt: '2026-11-19T19:30:00Z',
    from: 'Rocío Torres <rocio.torres@example.com>',
    subject: 'Para mi hermana',
    body: [
      'Querida Anabel:',
      '',
      'Nunca te lo digo, pero eres la persona más valiente que conozco. Me alegro muchísimo de que te hayas animado a vivir esta experiencia.',
      '',
      'Te echo de menos (aunque no te lo creas) 😄',
      '',
      'Rocío',
    ],
  }),
  message({
    id: 'demo-w1-17',
    receivedAt: '2026-11-19T21:10:00Z',
    from: 'Manuel Herrera <manuel.herrera@example.com>',
    subject: 'Carta para Álvaro',
    body: [
      'Querido hijo:',
      '',
      'Esta mañana, desayunando, tu madre y yo hablábamos de lo rápido que pasa el tiempo. Parece que fue ayer cuando te enseñé a montar en bici.',
      '',
      'Estamos deseando escuchar todo lo que vas a contarnos.',
      '',
      'Un abrazo fuerte,',
      'Papá',
    ],
  }),
  message({
    id: 'demo-w1-18',
    receivedAt: '2026-11-20T07:45:00Z',
    from: 'Sofía Vázquez <sofia.vazquez@example.com>',
    subject: 'Buenos días',
    body: [
      'Hola Irene, ¿qué tal estás?',
      '',
      'Te escribo desde el tren camino del trabajo. Ayer estuvimos viendo fotos tuyas de pequeña y nos reímos un montón.',
      '',
      'Que sepas que aquí todos te mandamos fuerza y cariño.',
      '',
      'Un beso,',
      'Sofía',
    ],
  }),
  message({
    id: 'demo-w1-19',
    receivedAt: '2026-11-20T09:00:00Z',
    from: 'Jorge Prieto <jorge.prieto@example.com>',
    subject: '[Para: Nuria Prieto] Desde Valencia',
    body: [
      'Querida Nuria:',
      '',
      'Te escribimos desde Valencia, donde hace un sol espléndido. Tus primos te mandan recuerdos y dicen que a la vuelta te toca organizar la paella.',
      '',
      'Abre bien los ojos y el corazón estos días.',
      '',
      'Un abrazo de toda la familia',
    ],
  }),
  message({
    id: 'demo-w1-20',
    receivedAt: '2026-11-20T10:30:00Z',
    from: 'Alberto Ruiz <alberto.ruiz@example.com>',
    subject: 'Carta para Carmen',
    body: [
      'Querida Carmen:',
      '',
      'Soy tu padrino. Me ha hecho mucha ilusión saber que estás en el retiro; yo fui a uno parecido con tu edad y todavía me acuerdo de muchas cosas.',
      '',
      'Guarda bien lo que vivas estos días.',
      '',
      'Un abrazo,',
      'Alberto',
    ],
  }),
  message({
    id: 'demo-w1-21',
    receivedAt: '2026-11-20T11:15:00Z',
    from: 'Lola Ramos <lola.ramos@example.com>',
    subject: 'Carta para María López',
    body: [
      'Querida María:',
      '',
      'Tu madrina te manda un abrazo enorme desde Sevilla. Me han dicho que el sitio es precioso y que la comida está buenísima, ¡aprovecha!',
      '',
      'Te quiero mucho, mi niña.',
      '',
      'Lola',
    ],
  }),
  message({
    id: 'demo-w1-22',
    receivedAt: '2026-11-20T12:40:00Z',
    from: 'Abuelo Ramón <ramon.martinez@example.com>',
    subject: 'Unas palabras del abuelo',
    body: [
      'Mi querido nieto Juan, estamos contigo.',
      '',
      'Tu abuela y yo ya no estamos para muchos viajes, pero te acompañamos desde aquí con el pensamiento. Escucha mucho y habla poco, que así se aprende.',
      '',
      'Un abrazo muy grande,',
      'El abuelo Ramón',
    ],
  }),
  message({
    id: 'demo-w1-23',
    receivedAt: '2026-11-20T13:05:00Z',
    from: 'Clara García <clara.garcia@example.com>',
    subject: '¡Hola, hermanita!',
    body: [
      'Querida Mari:',
      '',
      'Ya sé que odias que te llame hermanita, pero hoy te lo aguantas 😜',
      '',
      'Te echo muchísimo de menos. La casa está demasiado tranquila sin tus canciones a todo volumen. Mira quién te espera:',
      '',
      '[cid:perro@demo]',
      '',
      'Te quiero,',
      'Clara',
    ],
    attachments: [{ filename: 'perro.png', mimeType: 'image/png', size: 9334, contentId: 'perro@demo' }],
  }),
];

const WAVE_2 = [
  message({
    id: 'demo-w2-01',
    receivedAt: '2026-11-20T16:20:00Z',
    from: 'Elena Serrano <elena.serrano@example.com>',
    subject: 'Carta para Hugo',
    body: [
      'Querido Hugo:',
      '',
      'Perdona que la carta llegue un poco tarde: hasta ayer no supe que se podía escribir. Quiero que sepas que me acuerdo mucho de ti y que estoy muy orgullosa del paso que has dado.',
      '',
      'Un beso enorme,',
      'Tu madre',
    ],
  }),
  message({
    id: 'demo-w2-02',
    receivedAt: '2026-11-20T17:05:00Z',
    from: 'Lucas Romero <lucas.romero@example.com>',
    subject: 'Ánimo, hermano',
    body: [
      'Hola Sergio, ¿cómo va eso?',
      '',
      'Mamá dice que no te agobie con mensajes, así que solo te escribo esta carta. Aquí todo bien; el equipo ganó el sábado y te dedicamos el gol.',
      '',
      'Nos vemos pronto.',
      '',
      'Lucas',
    ],
  }),
  message({
    id: 'demo-w2-03',
    receivedAt: '2026-11-20T18:30:00Z',
    from: 'Ernesto López <ernesto.lopez@example.com>',
    subject: 'De tu padre',
    body: [
      'Querida María López:',
      '',
      'Sí, te pongo el apellido porque me han dicho que hay dos Marías en el grupo y no quiero que mi carta acabe en manos equivocadas 😉',
      '',
      'Estamos muy orgullosos de ti. Disfruta de cada momento.',
      '',
      'Un abrazo,',
      'Papá',
    ],
  }),
  message({
    id: 'demo-w2-04',
    receivedAt: '2026-11-20T19:45:00Z',
    from: 'Tomás Castillo <tomas.castillo@example.com>',
    subject: 'Carta para Elena',
    body: [
      'Querida Elena:',
      '',
      'Segunda carta, que la primera se nos quedó corta. Tu hermano pequeño quiere que te diga que ha aprendido a silbar.',
      '',
      'Un beso de todos,',
      'Papá',
    ],
  }),
];

const WAVE_3 = [
  message({
    id: 'demo-w3-01',
    receivedAt: '2026-11-21T08:10:00Z',
    from: 'Patricia Molina <patricia.molina@example.com>',
    subject: 'Carta para Claudia Molina',
    body: [
      'Querida Claudia:',
      '',
      'Te escribo con un café delante y la casa todavía dormida. Quería que, aunque fuera el último día, tuvieras unas palabras de casa.',
      '',
      'Ha sido precioso verte crecer este año. Vuelve con calma.',
      '',
      'Con todo mi cariño,',
      'Mamá',
    ],
  }),
  message({
    id: 'demo-w3-02',
    receivedAt: '2026-11-21T09:00:00Z',
    from: 'Familia Gil <familia.gil@example.com>',
    subject: 'Otra más',
    body: [
      'Querida Marta:',
      '',
      'Por si no podías ver el vídeo, aquí van también unas líneas por escrito: te queremos, te echamos de menos y estamos deseando abrazarte.',
      '',
      'Tus padres',
    ],
  }),
  message({
    id: 'demo-w3-03',
    receivedAt: '2026-11-21T09:45:00Z',
    from: 'Carmen Ruiz <carmen.ruiz.mama@example.com>',
    subject: 'Carta para Pablo',
    body: [
      'Querido Pablo:',
      '',
      'Último día. Sé que vas a volver distinto, y me hace muchísima ilusión.',
      '',
      'Te esperamos en la estación con pancarta (es broma… o no).',
      '',
      'Un beso,',
      'Mamá',
    ],
  }),
];

/**
 * @typedef {Object} DemoWave
 * @property {ReadonlyArray<import('../../../../application/ports/MailSourcePort.js').IncomingMessage>} letters
 * @property {readonly string[]} deletedMessageIds
 */

/** @type {ReadonlyArray<Readonly<DemoWave>>} */
export const DEMO_WAVES = Object.freeze([
  Object.freeze({ letters: Object.freeze(WAVE_1), deletedMessageIds: Object.freeze([]) }),
  Object.freeze({ letters: Object.freeze(WAVE_2), deletedMessageIds: Object.freeze([]) }),
  Object.freeze({ letters: Object.freeze(WAVE_3), deletedMessageIds: Object.freeze(['demo-w1-10']) }),
]);
