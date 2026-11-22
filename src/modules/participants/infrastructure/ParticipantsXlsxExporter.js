import ExcelJS from 'exceljs';

import { slugify } from '../../../domain/entities/Participant.js';
import { zonedParts } from '../../../domain/services/time.js';
import { ACCESSIBILITY_NEEDS, DIETARY_CODES, DietaryType } from '../domain/catalogs.js';

const DIETARY_TYPE_LABELS = Object.freeze({ [DietaryType.ALLERGY]: 'Alergia', [DietaryType.INTOLERANCE]: 'Intolerancia', [DietaryType.DIET]: 'Dieta' });
const MISSING_LABELS = Object.freeze({ firstSurname: 'primer apellido', age: 'edad', emergencyContact: 'contacto de emergencia', nameReview: 'revisar nombre' });

/**
 * @param {number} n
 * @returns {string}
 */
const pad = (n) => String(n).padStart(2, '0');

/**
 * YYYY-MM-DD → Excel date (UTC midnight, shown as dd/mm/yyyy).
 * @param {string | null} day
 */
function dayToDate(day) {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Excel workbook (.xlsx) with the participants of the current view: one row per
 * participant with the data organizers work with (contact, room and table, food,
 * accessibility…), plus an "Información" sheet with the criteria used. The identity
 * document is never exported.
 */
export class ParticipantsXlsxExporter {
  #timeZone;

  /** @param {{ timeZone: string }} options */
  constructor({ timeZone }) {
    this.#timeZone = timeZone;
  }

  /**
   * @param {Awaited<ReturnType<import('../application/ParticipantsUseCase.js').ParticipantsUseCase['exportData']>>} data
   * @returns {Promise<{ filename: string, buffer: Buffer }>}
   */
  async build(data) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Gestión del retiro';
    workbook.created = data.generatedAt;

    const sheet = workbook.addWorksheet('Participantes', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Nombre completo', key: 'displayName', width: 32 },
      { header: 'Nombre', key: 'givenNames', width: 18 },
      { header: 'Primer apellido', key: 'firstSurname', width: 18 },
      { header: 'Segundo apellido', key: 'secondSurname', width: 18 },
      { header: 'Apodos', key: 'aliases', width: 16 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Asistencia', key: 'attendance', width: 15 },
      { header: 'Confirmada el', key: 'confirmedAt', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Edad', key: 'age', width: 7 },
      { header: 'Fecha de nacimiento', key: 'birthDate', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Teléfono', key: 'phone', width: 16 },
      { header: 'Correo electrónico', key: 'email', width: 28 },
      { header: 'Contacto de emergencia', key: 'emergencyName', width: 24 },
      { header: 'Parentesco', key: 'emergencyRelationship', width: 14 },
      { header: 'Teléfono de emergencia', key: 'emergencyPhone', width: 18 },
      { header: 'Habitación', key: 'room', width: 16 },
      { header: 'Cama', key: 'bed', width: 14 },
      { header: 'Mesa', key: 'table', width: 12 },
      { header: 'Ronca', key: 'snores', width: 9 },
      { header: 'Alimentación', key: 'dietary', width: 40 },
      { header: 'Alergia grave', key: 'severe', width: 12 },
      { header: 'Accesibilidad', key: 'accessibility', width: 36 },
      { header: 'Apoyos durante el retiro', key: 'supports', width: 30 },
      { header: 'Observaciones', key: 'notes', width: 36 },
      { header: 'Cartas', key: 'letters', width: 8 },
      { header: 'Ficha', key: 'profile', width: 30 },
    ];

    for (const { view, record } of data.rows) {
      const contact = record.emergencyContacts[0] ?? null;
      sheet.addRow({
        displayName: view.displayName,
        givenNames: record.givenNames,
        firstSurname: record.firstSurname,
        secondSurname: record.secondSurname ?? '',
        aliases: record.aliases.join(', '),
        status: view.status === 'withdrawn' ? 'Baja' : 'Activo',
        attendance: view.status === 'withdrawn' ? '' : view.attendanceConfirmed ? 'Confirmada' : 'Sin confirmar',
        confirmedAt: record.attendanceConfirmedAt ?? null,
        age: view.age ?? null,
        birthDate: dayToDate(record.birthDate),
        phone: record.phone ?? '',
        email: record.email ?? '',
        emergencyName: contact?.name ?? '',
        emergencyRelationship: contact?.relationship ?? '',
        emergencyPhone: contact?.phone ?? '',
        room: view.room?.name ?? '',
        bed: view.room?.bed ?? '',
        table: view.table?.name ?? '',
        snores: { yes: 'Sí', no: 'No', unknown: '' }[/** @type {'yes' | 'no' | 'unknown'} */ (view.snores)] ?? '',
        dietary: record.dietary
          .map((d) => {
            const label = d.code === 'other' ? d.detail : /** @type {any} */ (DIETARY_CODES)[d.type]?.[d.code] ?? d.code;
            const severity = d.severity === 'severe' ? ' (grave)' : d.severity === 'mild' ? ' (leve)' : '';
            return `${DIETARY_TYPE_LABELS[/** @type {keyof typeof DIETARY_TYPE_LABELS} */ (d.type)] ?? d.type}: ${label}${severity}`;
          })
          .join('; '),
        severe: view.severeAllergy ? 'Sí' : '',
        accessibility: record.accessibilityNeeds
          .map((n) => `${n.code === 'other' ? n.detail : /** @type {any} */ (ACCESSIBILITY_NEEDS)[n.code] ?? n.code}${n.code !== 'other' && n.detail ? ` (${n.detail})` : ''}`)
          .join('; '),
        supports: record.supports ?? '',
        notes: record.notes ?? '',
        letters: view.letterCount,
        profile: view.complete ? 'Completa' : `Falta: ${view.missing.map((m) => MISSING_LABELS[/** @type {keyof typeof MISSING_LABELS} */ (m)] ?? m).join(', ')}`,
      });
    }

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FF111827' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.height = 30;
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    for (const key of ['dietary', 'accessibility', 'supports', 'notes']) sheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };

    const info = workbook.addWorksheet('Información');
    info.columns = [{ width: 26 }, { width: 70 }];
    const p = zonedParts(data.generatedAt, this.#timeZone);
    const fmtDay = (/** @type {string | null} */ day) => (day ? day.split('-').reverse().join('/') : '');
    const rows = [
      ['Retiro', data.retreat.name],
      ['Fechas', data.retreat.startDate && data.retreat.endDate ? `${fmtDay(data.retreat.startDate)} – ${fmtDay(data.retreat.endDate)}` : ''],
      ['Exportado el', `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`],
      ['Participantes exportados', `${data.rows.length} de ${data.total}`],
      ['Búsqueda', data.criteria.q || '(ninguna)'],
      ['Filtro', data.criteria.filter],
      ['Mesa', data.criteria.table],
      ['Orden', data.criteria.sort],
      [],
      ['Aviso', 'Contiene datos personales y de salud (alergias, accesibilidad, contactos de emergencia). Compártelo solo con quien lo necesite y bórralo cuando termine el retiro.'],
    ];
    for (const row of rows) info.addRow(row);
    info.getColumn(1).font = { bold: true };
    info.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

    const stamp = `${p.year}${pad(p.month)}${pad(p.day)}-${pad(p.hour)}${pad(p.minute)}`;
    const filename = `participantes_${slugify(data.retreat.name) || 'retiro'}_${stamp}.xlsx`;
    return { filename, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
  }
}
