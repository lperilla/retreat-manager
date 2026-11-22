import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import ExcelJS from 'exceljs';

import { ParticipantsXlsxExporter } from '../../src/modules/participants/infrastructure/ParticipantsXlsxExporter.js';
import { ScriptedMailSource, buildTestContainer, makeMessage } from '../helpers/applicationFakes.js';

const COMPLETE = Object.freeze({ emergencyContacts: [{ name: 'Contacto', relationship: 'Madre', phone: '600000000' }] });

async function setup() {
  const mailSource = new ScriptedMailSource(() => ({ letters: [makeMessage({ subject: 'Carta para Juan' })], deletedMessageIds: [], nextCursor: 'h-1', isFullListing: true }));
  const built = await buildTestContainer({ mailSource });
  await built.container.useCases.syncMailbox.execute();
  const { participants, accommodation } = built.container.useCases;
  await participants.create({ givenNames: 'Ana', firstSurname: 'Ruiz', age: 40, nationality: 'Colombia', ...COMPLETE, dietary: [{ type: 'allergy', code: 'nuts', severity: 'severe' }], identityDocument: { type: 'dni', number: '12345678Z' } });
  await participants.create({ givenNames: 'Eva', firstSurname: 'Gil', age: 25, ...COMPLETE });
  const mesa1 = await accommodation.createTable({ name: 'Mesa 1', capacity: 6 });
  const mesa2 = await accommodation.createTable({ name: 'Mesa 2', capacity: 6 });
  await accommodation.assignTable('ana-ruiz', { tableId: mesa2.id });
  await accommodation.assignTable('eva-gil', { tableId: mesa1.id });
  await accommodation.assignTable('juan-perez', { tableId: mesa1.id });
  return { ...built, mesa1, mesa2 };
}

describe('participants list: table filter and sorting', () => {
  it('filters by table (or without table) and returns room and table with each participant', async () => {
    const { container, mesa1 } = await setup();
    const list = (/** @type {any} */ q) => container.useCases.participants.list(q);
    assert.deepEqual((await list({ tableId: mesa1.id })).participants.map((p) => p.id), ['eva-gil', 'juan-perez']);
    const withoutTable = await list({ tableId: 'none' });
    assert.equal(withoutTable.participants.some((p) => p.table), false);
    assert.equal(withoutTable.participants.length, (await list({})).counts.noTable);
    assert.deepEqual((await list({ q: 'eva' })).participants[0].table, { id: mesa1.id, name: 'Mesa 1' });
    assert.deepEqual((await list({ q: 'colombia' })).participants.map((p) => p.id), ['ana-ruiz']);
    const ana = await container.useCases.participants.get({ id: 'ana-ruiz' });
    assert.equal(ana.nationality, 'Colombia');
    const edited = await container.useCases.participants.update('ana-ruiz', { nationality: 'Perú' });
    assert.equal(edited.participant.nationality, 'Perú');
  });

  it('sorts by any column in both directions, empty values last', async () => {
    const { container } = await setup();
    const ids = async (/** @type {any} */ q) => (await container.useCases.participants.list(q)).participants.map((p) => p.id);
    const byAge = await ids({ sort: 'age', dir: 'asc' });
    assert.deepEqual(byAge.slice(0, 2), ['eva-gil', 'ana-ruiz']);
    assert.deepEqual((await ids({ sort: 'age', dir: 'desc' })).slice(0, 2), ['ana-ruiz', 'eva-gil']);
    const byTable = await ids({ sort: 'table', dir: 'desc' });
    assert.deepEqual(byTable.slice(0, 3), ['ana-ruiz', 'eva-gil', 'juan-perez']);
    assert.deepEqual((await ids({ sort: 'letters', dir: 'desc' }))[0], 'juan-perez');
    await assert.rejects(container.useCases.participants.list({ sort: 'phone' }), { code: 'VALIDATION_ERROR' });
  });
});

describe('Excel export', () => {
  it('exports the current view (all when nothing is filtered) without the identity document', async () => {
    const { container, mesa1 } = await setup();
    const exporter = new ParticipantsXlsxExporter({ timeZone: 'Europe/Madrid' });

    const all = await exporter.build(await container.useCases.participants.exportData({}));
    assert.match(all.filename, /^participantes_retiro_\d{8}-\d{4}\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(all.buffer);
    const sheet = /** @type {ExcelJS.Worksheet} */ (workbook.getWorksheet('Participantes'));
    assert.equal(sheet.rowCount - 1, (await container.useCases.participants.list({})).total);
    const header = /** @type {string[]} */ (sheet.getRow(1).values).slice(1);
    assert.ok(header.includes('Mesa') && header.includes('Alimentación') && header.includes('Contacto de emergencia') && header.includes('Nacionalidad'));
    assert.equal(header.some((h) => /documento/i.test(String(h))), false);
    const ana = sheet.getRows(2, sheet.rowCount - 1)?.find((r) => r.getCell(1).value === 'Ana Ruiz');
    assert.equal(ana?.getCell(header.indexOf('Alimentación') + 1).value, 'Alergia: Frutos de cáscara (grave)');
    assert.equal(ana?.getCell(header.indexOf('Mesa') + 1).value, 'Mesa 2');
    assert.equal(ana?.getCell(header.indexOf('Nacionalidad') + 1).value, 'Colombia');
    let text = '';
    sheet.eachRow((row) => { text += JSON.stringify(row.values); });
    assert.equal(text.includes('12345678Z'), false);

    const filtered = await exporter.build(await container.useCases.participants.exportData({ tableId: mesa1.id, sort: 'name', dir: 'desc' }));
    const second = new ExcelJS.Workbook();
    await second.xlsx.load(filtered.buffer);
    const rows = /** @type {ExcelJS.Worksheet} */ (second.getWorksheet('Participantes')).getRows(2, 2)?.map((r) => r.getCell(1).value);
    assert.deepEqual(rows, ['Juan Pérez', 'Eva Gil']);
    const info = /** @type {ExcelJS.Worksheet} */ (second.getWorksheet('Información'));
    const infoText = JSON.stringify(info.getSheetValues());
    assert.match(infoText, /Mesa 1/);
    assert.match(infoText, /Nombre \(descendente\)/);
  });
});
