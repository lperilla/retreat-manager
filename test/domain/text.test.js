import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cleanForAnalysis,
  meaningfulLength,
  normalizeText,
  normalizeWithMap,
  parseSenderName,
  sliceOriginal,
  stripQuotedText,
  stripSignature,
  stripSubjectPrefixes,
} from '../../src/domain/services/text.js';

describe('normalization', () => {
  it('lowercases, strips accents (ñ → n) and collapses whitespace', () => {
    assert.equal(normalizeText('  Querida   MARÍA\tJosé  Núñez  '), 'querida maria jose nunez');
  });

  it('keeps emojis and, when asked, line breaks', () => {
    assert.equal(normalizeText('Hola 😊\n\n  Juan', { keepNewlines: true }), 'hola 😊\n\njuan');
  });

  it('handles decomposed accents and CRLF', () => {
    assert.equal(normalizeText('Mari\u0301a\r\nGarci\u0301a', { keepNewlines: true }), 'maria\ngarcia');
  });

  it('maps normalized ranges back to the original text', () => {
    const original = '¡Hola,  Querida   MARÍA! 😊 Ñandú';
    const { text, map } = normalizeWithMap(original);
    const start = text.indexOf('querida maria');
    assert.equal(sliceOriginal(original, map, start, start + 'querida maria'.length), 'Querida   MARÍA');
    const emojiStart = text.indexOf('😊');
    assert.equal(sliceOriginal(original, map, emojiStart, text.length), '😊 Ñandú');
  });

  it('counts only letters and digits as meaningful', () => {
    assert.equal(meaningfulLength('¡Ánimo! 😊 2025'), 9);
  });
});

describe('subject and sender helpers', () => {
  it('strips nested reply/forward prefixes', () => {
    assert.equal(stripSubjectPrefixes('RE: Fwd: RV:  Carta para Ana'), 'Carta para Ana');
  });

  it('extracts the sender display name or the e-mail local part', () => {
    assert.equal(parseSenderName('"Lucía Fernández" <lucia@example.com>'), 'Lucía Fernández');
    assert.equal(parseSenderName('Ana Pérez <ana@example.com>'), 'Ana Pérez');
    assert.equal(parseSenderName('maria.garcia@example.com'), 'maria garcia');
    assert.equal(parseSenderName(''), '');
  });
});

describe('stripQuotedText', () => {
  it('cuts at a Spanish reply attribution', () => {
    const body = 'Hola Juan\n\nEl lun, 3 nov 2025 a las 10:15, Ana <ana@x.com> escribió:\n> texto citado';
    assert.equal(stripQuotedText(body), 'Hola Juan');
  });

  it('cuts at an attribution wrapped over two lines', () => {
    const body = 'Hola Juan\nEl lun, 3 nov 2025 a las 10:15, Ana Pérez (<ana@x.com>)\nescribió:\n> texto';
    assert.equal(stripQuotedText(body), 'Hola Juan');
  });

  it('cuts at an Outlook header block but keeps a letter starting with "De:/Para:"', () => {
    const quoted = 'Gracias\n________________________________\nDe: Coordinación <retiro@x.com>\nEnviado: lunes\nPara: Familia\nAsunto: Cartas\n\nTexto antiguo';
    assert.equal(stripQuotedText(quoted), 'Gracias');
    const letter = 'De: Mamá\nPara: Juan\n\nTe queremos mucho.';
    assert.equal(stripQuotedText(letter), letter);
  });

  it('cuts at "Mensaje original" markers', () => {
    assert.equal(stripQuotedText('Hola\n-----Mensaje original-----\nDe: x'), 'Hola');
  });

  it('keeps forwarded content without its header lines', () => {
    const body = 'Te la reenvío.\n\n---------- Mensaje reenviado ---------\nDe: Abuela <a@x.com>\nFecha: hoy\nAsunto: Carta\nPara: b@x.com\n\nQuerida Lucía:\nÁnimo.';
    assert.equal(stripQuotedText(body), 'Te la reenvío.\n\nQuerida Lucía:\nÁnimo.');
  });

  it('removes ">" lines', () => {
    assert.equal(stripQuotedText('> citado\nPropio\n  > también citado'), 'Propio');
  });
});

describe('stripSignature', () => {
  it('removes mobile footers', () => {
    assert.equal(stripSignature('Ánimo campeón\n\nEnviado desde mi iPhone'), 'Ánimo campeón');
    assert.equal(stripSignature('Ánimo\nSent from my Galaxy'), 'Ánimo');
    assert.equal(stripSignature('Enviado desde mi iPhone'), '');
  });

  it('cuts at the RFC 3676 delimiter', () => {
    assert.equal(stripSignature('Texto\n-- \nPepe\n600 000 000'), 'Texto');
  });

  it('removes the short block after a closing phrase and names after its comma', () => {
    assert.equal(stripSignature('Querido Juan:\nÁnimo.\nUn beso enorme,\nMamá y Papá'), 'Querido Juan:\nÁnimo.\nUn beso enorme,');
    assert.equal(stripSignature('Querido Juan:\nÁnimo.\nUn beso, Mamá'), 'Querido Juan:\nÁnimo.\nUn beso,');
  });

  it('keeps long paragraphs after a closing-like phrase', () => {
    const body = 'Querido Juan:\nUn abrazo de todos los primos.\nAyer fuimos a ver a la abuela y nos contó muchas cosas de cuando eras pequeño.';
    assert.equal(stripSignature(body), body);
  });

  it('removes trailing lines made only of the sender name, never the first line', () => {
    assert.equal(stripSignature('Querido Juan:\nÁnimo.\nLucía', { senderName: 'Lucía Fernández' }), 'Querido Juan:\nÁnimo.');
    assert.equal(stripSignature('Lucía:\nÁnimo.', { senderName: 'Lucía Fernández' }), 'Lucía:\nÁnimo.');
  });

  it('cleanForAnalysis combines quotes and signatures using the From header', () => {
    const body = 'Querido Juan:\nÁnimo.\nAna Martín\n\nEl lun, 3 nov 2025, Pepe <p@x.com> escribió:\n> Hola';
    assert.equal(cleanForAnalysis({ body, from: 'Ana Martín <ana@x.com>' }), 'Querido Juan:\nÁnimo.');
  });
});
