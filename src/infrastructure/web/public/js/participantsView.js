/**
 * Participants module: list (search + filters), detail, registration/edition form and the
 * retreat data (dates, automatic deletion). Everything is built with text nodes (never
 * innerHTML); health-related data is shown only here, never in exports.
 */
import { api } from './api.js';
import { $, debounce, h, replaceChildren, withBusy } from './dom.js';
import { lettersLabel, plural } from './format.js';
import { emit } from './state.js';
import { confirmDialog, toast, toastError } from './ui.js';
import { accommodationSection, loadAccommodation, sectionTabs } from './accommodationView.js';

const FILTERS = Object.freeze([
  ['all', 'Todos'],
  ['active', 'Activos'],
  ['incomplete', 'Fichas incompletas'],
  ['dietary', 'Alimentación'],
  ['accessibility', 'Accesibilidad'],
  ['snores', 'Roncan'],
  ['withdrawn', 'Dados de baja'],
  ['noRoom', 'Sin habitación'],
  ['noTable', 'Sin mesa'],
  ['confirmed', 'Asistencia confirmada'],
  ['unconfirmed', 'Sin confirmar'],
]);
/** Filters resolved in the browser with the accommodation data. */
const ACCOMMODATION_FILTERS = new Set(['noRoom', 'noTable']);

const MISSING_LABELS = Object.freeze({
  firstSurname: 'el primer apellido',
  age: 'la edad o la fecha de nacimiento',
  emergencyContact: 'una persona de contacto para emergencias',
  nameReview: 'revisar cómo se reparten nombre y apellidos',
});

const DIETARY_GROUPS = Object.freeze([
  ['allergy', 'Alergias'],
  ['intolerance', 'Intolerancias'],
  ['diet', 'Dietas'],
]);

const DATE_FORMAT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const INSTANT_FORMAT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

/** List state kept while navigating. */
const listState = { q: '', filter: 'all' };
/** @type {any} */
let catalogs = null;

async function getCatalogs() {
  catalogs ??= await api.catalogs();
  return catalogs;
}

/**
 * @param {string | null} date  YYYY-MM-DD
 */
function formatDay(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return DATE_FORMAT.format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * @param {string} type
 * @param {string} code
 */
function dietaryLabel(type, code) {
  return catalogs?.dietary?.[type]?.find((/** @type {any} */ e) => e.code === code)?.label ?? code;
}

/** @param {string} code */
function needLabel(code) {
  return catalogs?.accessibilityNeeds?.find((/** @type {any} */ e) => e.code === code)?.label ?? code;
}

/**
 * @param {{ mode: 'list' | 'detail' | 'new' | 'edit' | 'rooms' | 'tables', id?: string | null }} route
 */
export async function loadParticipants(route) {
  if (route.mode === 'rooms' || route.mode === 'tables') return loadAccommodation(route.mode);
  await getCatalogs();
  if (route.mode === 'new') return renderForm(null);
  if (route.mode === 'edit' && route.id) return renderForm(await api.participant(route.id));
  if (route.mode === 'detail' && route.id) return renderDetail(await api.participant(route.id));
  return renderList();
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function renderList() {
  document.title = 'Participantes · Gestión del retiro';
  const view = $('#view-people');
  const [data, retreat] = await Promise.all([fetchList(), api.retreat()]);

  const search = h('input', {
    type: 'search',
    class: 'form-control',
    id: 'people-search',
    placeholder: 'Nombre, apodo, teléfono o correo',
    autocomplete: 'off',
    value: listState.q,
  });
  search.addEventListener(
    'input',
    debounce(() => {
      listState.q = /** @type {HTMLInputElement} */ (search).value;
      void refreshList();
    }, 250),
  );

  const chips = h(
    'div',
    { class: 'filter-chips', role: 'group', 'aria-label': 'Filtrar participantes' },
    FILTERS.map(([value, label]) => {
      const count = ['active', 'withdrawn', 'incomplete', 'noRoom', 'noTable', 'confirmed', 'unconfirmed'].includes(value) ? data.counts[value] : null;
      return h('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': listState.filter === value ? 'true' : 'false',
        text: count === null ? label : `${label} (${count})`,
        onClick: () => {
          listState.filter = value;
          void renderList().catch(toastError);
        },
      });
    }),
  );

  replaceChildren(
    view,
    sectionTabs('participants'),
    h(
      'div',
      { class: 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-3' },
      h('div', {}, h('h1', { class: 'h3 mb-0', text: 'Participantes' }), h('p', { class: 'text-body-secondary mb-0', text: `${plural(data.total, 'participante', 'participantes')} en ${retreat.name} · ${data.counts.confirmed} de ${data.counts.active} con asistencia confirmada` })),
      h('a', { class: 'btn btn-primary', href: '#/participantes/nuevo', text: '+ Nuevo participante' }),
    ),
    retreatPanel(retreat),
    h(
      'div',
      { class: 'card mb-3' },
      h(
        'div',
        { class: 'card-body d-flex flex-column gap-2' },
        h('label', { class: 'form-label small mb-0', for: 'people-search', text: 'Buscar' }),
        search,
        chips,
      ),
    ),
    h('div', { id: 'people-list' }, peopleTable(data)),
  );
}

/**
 * Participants of the list with their room and table ("Sin habitación" / "Sin mesa" are
 * filtered here, with the accommodation data).
 */
async function fetchList() {
  const local = ACCOMMODATION_FILTERS.has(listState.filter);
  const [data, places] = await Promise.all([api.participants({ q: listState.q, filter: local ? 'active' : listState.filter }), api.accommodation()]);
  const participants = data.participants
    .map((/** @type {any} */ p) => ({ ...p, room: places.byParticipant[p.id]?.room ?? null, table: places.byParticipant[p.id]?.table ?? null }))
    .filter((/** @type {any} */ p) => (listState.filter === 'noRoom' ? !p.room : listState.filter === 'noTable' ? !p.table : true));
  return { ...data, participants, counts: { ...data.counts, noRoom: places.withoutRoom.length, noTable: places.withoutTable.length } };
}

async function refreshList() {
  try {
    const data = await fetchList();
    replaceChildren($('#people-list'), peopleTable(data));
  } catch (error) {
    toastError(error);
  }
}

/**
 * @param {any} data
 */
function peopleTable(data) {
  if (data.participants.length === 0) {
    return h('p', { class: 'text-body-secondary', text: data.total === 0 ? 'Todavía no hay participantes. Pulsa «Nuevo participante».' : 'Ningún participante coincide con la búsqueda.' });
  }
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'table-responsive' },
      h(
        'table',
        { class: 'table table-hover align-middle mb-0 people-table' },
        h(
          'thead',
          {},
          h('tr', {}, ['Nombre', 'Asistencia', 'Edad', 'Teléfono', 'Contacto de emergencia', 'Habitación', 'Mesa', 'Alimentación', 'Accesibilidad', 'Cartas'].map((label) => h('th', { scope: 'col', text: label }))),
        ),
        h(
          'tbody',
          {},
          data.participants.map((/** @type {any} */ p) =>
            h(
              'tr',
              { class: p.status === 'withdrawn' ? 'is-withdrawn' : '' },
              h(
                'td',
                {},
                h('a', { class: 'fw-semibold text-decoration-none', href: `#/participantes/${encodeURIComponent(p.id)}`, text: p.displayName }),
                p.status === 'withdrawn' ? h('span', { class: 'badge text-bg-secondary ms-2', text: 'Baja' }) : null,
                p.complete ? null : h('span', { class: 'badge text-bg-warning ms-2', text: 'Ficha incompleta' }),
                p.aliases.length > 0 ? h('div', { class: 'small text-body-secondary', text: `Apodos: ${p.aliases.join(', ')}` }) : null,
              ),
              h('td', {}, attendanceToggle(p)),
              h('td', { text: p.age ?? '—' }),
              h('td', { text: p.phone ?? '—' }),
              h('td', {}, p.emergencyContact ? `${p.emergencyContact.name} · ${p.emergencyContact.phone}` : h('span', { class: 'text-danger', text: 'Falta' })),
              h('td', { text: p.room ? `${p.room.name}${p.room.bed ? ` · ${p.room.bed}` : ''}` : '—' }),
              h('td', { text: p.table?.name ?? '—' }),
              h(
                'td',
                {},
                p.dietaryCount > 0
                  ? h('span', { class: `badge ${p.severeAllergy ? 'text-bg-danger' : 'text-bg-light border'}`, text: p.severeAllergy ? `${p.dietaryCount} · grave` : String(p.dietaryCount) })
                  : '—',
              ),
              h('td', {}, p.accessibilityCount > 0 ? h('span', { class: 'badge text-bg-info', text: String(p.accessibilityCount) }) : '—'),
              h('td', {}, h('a', { href: `#/participante/${encodeURIComponent(p.id)}`, text: String(p.letterCount), title: `Ver ${lettersLabel(p.letterCount)}` })),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * One-click attendance toggle (active participants only).
 * @param {any} p
 */
function attendanceToggle(p) {
  if (p.status === 'withdrawn') return h('span', { class: 'text-body-secondary', text: '—' });
  const button = /** @type {HTMLButtonElement} */ (
    h('button', {
      type: 'button',
      class: `chip attendance-chip${p.attendanceConfirmed ? ' is-confirmed' : ''}`,
      'aria-pressed': p.attendanceConfirmed ? 'true' : 'false',
      title: p.attendanceConfirmed ? 'Pulsa para quitar la confirmación' : 'Pulsa para confirmar la asistencia',
      text: p.attendanceConfirmed ? 'Confirmada' : 'Sin confirmar',
    })
  );
  button.addEventListener('click', () =>
    void withBusy(button, async () => {
      try {
        await api.setAttendance(p.id, !p.attendanceConfirmed);
        emit('data-changed');
      } catch (error) {
        toastError(error);
      }
    }),
  );
  return button;
}

/**
 * Retreat dates and automatic deletion (with the manual "close now").
 * @param {any} retreat
 */
function retreatPanel(retreat) {
  const dates = retreat.startDate && retreat.endDate ? `del ${formatDay(retreat.startDate)} al ${formatDay(retreat.endDate)}` : 'sin fechas';
  const deletion = retreat.deletionDate
    ? `Los datos personales se borrarán automáticamente el ${INSTANT_FORMAT.format(new Date(retreat.deletionDate))} (${retreat.retentionDays} días después del último día).`
    : 'Indica la fecha de fin para programar el borrado automático de los datos personales.';

  const form = h(
    'form',
    { class: 'row g-2 align-items-end mt-2', hidden: true, novalidate: true },
    field('col-md-5', 'retreat-name', 'Nombre del retiro', h('input', { class: 'form-control form-control-sm', id: 'retreat-name', value: retreat.name, maxlength: '120', required: true })),
    field('col-md-3', 'retreat-start', 'Primer día', h('input', { class: 'form-control form-control-sm', id: 'retreat-start', type: 'date', value: retreat.startDate ?? '' })),
    field('col-md-3', 'retreat-end', 'Último día', h('input', { class: 'form-control form-control-sm', id: 'retreat-end', type: 'date', value: retreat.endDate ?? '' })),
    h('div', { class: 'col-md-1 d-grid' }, h('button', { type: 'submit', class: 'btn btn-sm btn-primary', text: 'Guardar' })),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    void withBusy(button, async () => {
      try {
        await api.updateRetreat({
          name: /** @type {HTMLInputElement} */ ($('#retreat-name')).value,
          startDate: /** @type {HTMLInputElement} */ ($('#retreat-start')).value || null,
          endDate: /** @type {HTMLInputElement} */ ($('#retreat-end')).value || null,
        });
        toast('Datos del retiro guardados.');
        emit('data-changed');
      } catch (error) {
        toastError(error);
      }
    });
  });

  const confirmInput = h('input', { class: 'form-control form-control-sm', id: 'retreat-confirm', autocomplete: 'off', placeholder: retreat.name });
  const closeForm = h(
    'form',
    { class: 'retreat-danger mt-3 p-3 border border-danger-subtle rounded', hidden: true, novalidate: true },
    h('p', { class: 'small mb-2' }, h('strong', { text: 'Cerrar el retiro ahora y borrar todos sus datos. ' }), 'Se eliminan de forma definitiva los participantes (con alergias, necesidades y contactos de emergencia), las cartas, las asignaciones, el estado de impresión, la caché de adjuntos y los archivos exportados. Los correos de Gmail no se tocan: bórralos allí.'),
    h('label', { class: 'form-label small', for: 'retreat-confirm', text: `Para confirmar, escribe el nombre del retiro: ${retreat.name}` }),
    h('div', { class: 'd-flex gap-2' }, confirmInput, h('button', { type: 'submit', class: 'btn btn-sm btn-danger text-nowrap', text: 'Cerrar y borrar' })),
  );
  closeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = /** @type {HTMLButtonElement} */ (closeForm.querySelector('button[type="submit"]'));
    void withBusy(button, async () => {
      try {
        await api.closeRetreat(/** @type {HTMLInputElement} */ (confirmInput).value);
        toast('Retiro cerrado: sus datos se han borrado.', 'warning');
        emit('data-changed');
      } catch (error) {
        toastError(error);
      }
    });
  });

  return h(
    'section',
    { class: 'card mb-3 retreat-card', 'aria-label': 'Datos del retiro' },
    h(
      'div',
      { class: 'card-body' },
      h(
        'div',
        { class: 'd-flex flex-wrap justify-content-between gap-2' },
        h('div', {}, h('h2', { class: 'h6 mb-1', text: `${retreat.name} · ${dates}` }), h('p', { class: 'small text-body-secondary mb-0', text: deletion })),
        h(
          'div',
          { class: 'd-flex gap-2 align-items-start' },
          h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Editar datos del retiro', onClick: () => (form.hidden = !form.hidden) }),
          h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', text: 'Cerrar retiro…', onClick: () => (closeForm.hidden = !closeForm.hidden) }),
        ),
      ),
      form,
      closeForm,
    ),
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/**
 * @param {any} p
 */
async function renderDetail(p) {
  document.title = `${p.displayName} · Participantes`;
  const view = $('#view-people');
  const missing = p.missing.map((/** @type {keyof typeof MISSING_LABELS} */ m) => MISSING_LABELS[m]);

  const actions = h(
    'div',
    { class: 'd-flex flex-wrap gap-2' },
    p.status === 'withdrawn'
      ? null
      : h('button', {
          type: 'button',
          class: `btn ${p.attendanceConfirmed ? 'btn-success' : 'btn-outline-secondary'}`,
          'aria-pressed': p.attendanceConfirmed ? 'true' : 'false',
          text: p.attendanceConfirmed ? 'Asistencia confirmada' : 'Confirmar asistencia',
          title: p.attendanceConfirmed ? 'Pulsa para quitar la confirmación' : 'Marcar que asistirá al retiro',
          onClick: (/** @type {Event} */ e) =>
            void withBusy(/** @type {HTMLButtonElement} */ (e.currentTarget), async () => {
              try {
                await api.setAttendance(p.id, !p.attendanceConfirmed);
                toast(p.attendanceConfirmed ? 'Confirmación de asistencia retirada.' : 'Asistencia confirmada.');
                emit('data-changed');
              } catch (error) {
                toastError(error);
              }
            }),
        }),
    h('a', { class: 'btn btn-primary', href: `#/participantes/${encodeURIComponent(p.id)}/editar`, text: 'Editar' }),
    h('a', { class: 'btn btn-outline-primary', href: `#/participante/${encodeURIComponent(p.id)}`, text: `Ver cartas (${p.letterCount})` }),
    p.status === 'withdrawn'
      ? h('button', { type: 'button', class: 'btn btn-outline-success', text: 'Reactivar', onClick: (/** @type {Event} */ e) => void statusChange(e, p, 'reactivate') })
      : h('button', { type: 'button', class: 'btn btn-outline-secondary', text: 'Dar de baja…', onClick: (/** @type {Event} */ e) => void statusChange(e, p, 'withdraw') }),
    h('button', {
      type: 'button',
      class: 'btn btn-outline-danger',
      text: 'Eliminar…',
      disabled: p.letterCount > 0,
      title: p.letterCount > 0 ? 'Tiene cartas asignadas: dale de baja en su lugar' : 'Eliminar el participante',
      onClick: (/** @type {Event} */ e) => void removeParticipant(e, p),
    }),
  );

  const dl = (/** @type {Array<[string, any]>} */ rows) =>
    h('dl', { class: 'row mb-0 small-dl' }, rows.flatMap(([label, value]) => [h('dt', { class: 'col-sm-5', text: label }), h('dd', { class: 'col-sm-7', text: value === null || value === undefined || value === '' ? '—' : String(value) })]));

  const section = (/** @type {string} */ title, /** @type {any} */ body) =>
    h('section', { class: 'col-lg-6' }, h('div', { class: 'card h-100' }, h('div', { class: 'card-body' }, h('h2', { class: 'h6 text-uppercase text-body-secondary', text: title }), body)));

  const dietary =
    p.dietary.length === 0
      ? h('p', { class: 'mb-0 text-body-secondary', text: 'Sin alergias, intolerancias ni dietas indicadas.' })
      : h(
          'ul',
          { class: 'mb-0' },
          p.dietary.map((/** @type {any} */ d) =>
            h(
              'li',
              {},
              `${DIETARY_GROUPS.find(([t]) => t === d.type)?.[1].replace(/s$/, '') ?? d.type}: ${dietaryLabel(d.type, d.code)}`,
              d.detail ? ` (${d.detail})` : '',
              d.severity === 'severe' ? h('span', { class: 'badge text-bg-danger ms-2', text: 'Grave' }) : d.severity === 'mild' ? h('span', { class: 'badge text-bg-light border ms-2', text: 'Leve' }) : null,
            ),
          ),
        );
  const needs = h(
    'div',
    {},
    p.accessibilityNeeds.length === 0
      ? h('p', { class: 'text-body-secondary', text: 'Sin necesidades de accesibilidad indicadas.' })
      : h('ul', {}, p.accessibilityNeeds.map((/** @type {any} */ n) => h('li', { text: `${needLabel(n.code)}${n.detail ? ` (${n.detail})` : ''}` }))),
    h('p', { class: 'mb-0' }, h('strong', { text: 'Apoyos durante el retiro: ' }), p.supports ?? '—'),
  );

  replaceChildren(
    view,
    h('nav', { class: 'my-3', 'aria-label': 'Ruta' }, h('a', { href: '#/participantes', text: '← Participantes' })),
    h(
      'header',
      { class: 'd-flex flex-wrap justify-content-between align-items-start gap-3 mb-3' },
      h(
        'div',
        {},
        h('h1', { class: 'h3 mb-1', text: p.displayName }),
        h(
          'p',
          { class: 'text-body-secondary mb-0' },
          p.age !== null ? `${p.age} años` : 'Edad sin indicar',
          p.aliases.length > 0 ? ` · Apodos: ${p.aliases.join(', ')}` : '',
          p.status === 'withdrawn' ? ' · Dado de baja: no está en el retiro' : '',
          p.status !== 'withdrawn' ? (p.attendanceConfirmed ? ` · Asistencia confirmada${p.attendanceConfirmedAt ? ` el ${INSTANT_FORMAT.format(new Date(p.attendanceConfirmedAt))}` : ''}` : ' · Asistencia sin confirmar') : '',
        ),
      ),
      actions,
    ),
    missing.length > 0
      ? h('div', { class: 'alert alert-warning', role: 'status' }, h('strong', { text: 'Ficha incompleta. ' }), `Falta ${missing.join(', ')}.`)
      : null,
    h(
      'div',
      { class: 'row g-3' },
      section(
        'Datos personales',
        dl([
          ['Nombre', p.givenNames],
          ['Primer apellido', p.firstSurname],
          ['Segundo apellido', p.secondSurname],
          ['Fecha de nacimiento', formatDay(p.birthDate)],
          ['Edad', p.age],
        ]),
      ),
      section(
        'Contacto',
        h(
          'div',
          {},
          dl([
            ['Teléfono', p.phone],
            ['Correo electrónico', p.email],
          ]),
          h('h3', { class: 'h6 mt-3', text: 'Emergencias' }),
          p.emergencyContacts.length === 0
            ? h('p', { class: 'text-danger mb-0', text: 'Falta una persona de contacto para emergencias.' })
            : h('ul', { class: 'mb-0' }, p.emergencyContacts.map((/** @type {any} */ c) => h('li', { text: `${c.name}${c.relationship ? ` (${c.relationship})` : ''} · ${c.phone}` }))),
        ),
      ),
      section('Alimentación', dietary),
      section('Accesibilidad y apoyos', needs),
      section('Habitación y mesa', await accommodationSection(p)),
      section('Estancia', dl([['Ronca', { yes: 'Sí', no: 'No', unknown: 'No consta' }[/** @type {'yes'|'no'|'unknown'} */ (p.snores)]]])),
      section('Observaciones', h('p', { class: 'mb-0 pre-wrap', text: p.notes ?? 'Sin observaciones.' })),
    ),
  );
}

/**
 * @param {Event} event
 * @param {any} p
 * @param {'withdraw' | 'reactivate'} action
 */
async function statusChange(event, p, action) {
  if (action === 'withdraw') {
    const accepted = await confirmDialog({
      title: `¿Dar de baja a ${p.displayName}?`,
      body: 'Dejará de aparecer en el panel y en los lotes de impresión. Sus cartas se conservan, marcadas como «no está en el retiro», y se pueden consultar en «Por revisar». Se puede reactivar después.',
      confirmLabel: 'Dar de baja',
    });
    if (!accepted) return;
  }
  await withBusy(/** @type {HTMLButtonElement} */ (event.currentTarget), async () => {
    try {
      if (action === 'withdraw') await api.withdrawParticipant(p.id);
      else await api.reactivateParticipant(p.id);
      toast(action === 'withdraw' ? `${p.displayName} dado de baja.` : `${p.displayName} vuelve a estar en el retiro.`);
      emit('data-changed');
    } catch (error) {
      toastError(error);
    }
  });
}

/**
 * @param {Event} event
 * @param {any} p
 */
async function removeParticipant(event, p) {
  const accepted = await confirmDialog({
    title: `¿Eliminar a ${p.displayName}?`,
    body: 'Se borrará su ficha de forma definitiva. Solo es posible porque no tiene cartas asignadas.',
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!accepted) return;
  await withBusy(/** @type {HTMLButtonElement} */ (event.currentTarget), async () => {
    try {
      await api.deleteParticipant(p.id);
      toast(`${p.displayName} eliminado.`);
      window.location.hash = '#/participantes';
    } catch (error) {
      toastError(error);
    }
  });
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

/**
 * @param {string} col
 * @param {string} id
 * @param {string} label
 * @param {HTMLElement} control
 * @param {string} [help]
 */
function field(col, id, label, control, help) {
  return h('div', { class: col }, h('label', { class: 'form-label small mb-1', for: id, text: label }), control, help ? h('div', { class: 'form-text', text: help }) : null);
}

/**
 * @param {any | null} p  Participant detail, or null for a new one.
 */
function renderForm(p) {
  const editing = p !== null;
  document.title = `${editing ? 'Editar' : 'Nuevo'} participante · Gestión del retiro`;
  const view = $('#view-people');
  const input = (/** @type {string} */ id, /** @type {Record<string, any>} */ props = {}) =>
    h('input', { class: 'form-control', id, name: id, autocomplete: 'off', ...props });

  const contacts = [0, 1].map((index) => {
    const c = p?.emergencyContacts?.[index] ?? {};
    return {
      name: input(`ec-name-${index}`, { value: c.name ?? '', maxlength: '120', required: index === 0 }),
      relationship: input(`ec-rel-${index}`, { value: c.relationship ?? '', maxlength: '60' }),
      phone: input(`ec-phone-${index}`, { value: c.phone ?? '', type: 'tel', maxlength: '40', required: index === 0 }),
    };
  });
  const secondContact = h(
    'div',
    { class: 'row g-2 mt-1', hidden: !(p?.emergencyContacts?.length > 1) },
    field('col-md-5', 'ec-name-1', 'Segunda persona de contacto', contacts[1].name),
    field('col-md-3', 'ec-rel-1', 'Parentesco', contacts[1].relationship),
    field('col-md-4', 'ec-phone-1', 'Teléfono', contacts[1].phone),
  );

  /** @type {Array<{ type: string, code: string, box: HTMLInputElement, severity: HTMLSelectElement | null, detail: HTMLInputElement | null }>} */
  const dietaryControls = [];
  const dietaryGroups = DIETARY_GROUPS.map(([type, title]) =>
    h(
      'fieldset',
      { class: 'mb-3' },
      h('legend', { class: 'h6', text: title }),
      h(
        'div',
        { class: 'catalog-grid' },
        catalogs.dietary[type].map((/** @type {any} */ entry) => {
          const current = p?.dietary?.find((/** @type {any} */ d) => d.type === type && d.code === entry.code);
          const id = `diet-${type}-${entry.code}`;
          const box = /** @type {HTMLInputElement} */ (h('input', { class: 'form-check-input', type: 'checkbox', id, checked: Boolean(current) }));
          const severity =
            type === 'diet'
              ? null
              : /** @type {HTMLSelectElement} */ (
                  h(
                    'select',
                    { class: 'form-select form-select-sm', 'aria-label': `Gravedad: ${entry.label}` },
                    h('option', { value: '', text: 'Gravedad…' }),
                    catalogs.severities.map((/** @type {any} */ s) => h('option', { value: s.code, text: s.label, selected: current?.severity === s.code })),
                  )
                );
          const detail =
            entry.code === 'other'
              ? /** @type {HTMLInputElement} */ (h('input', { class: 'form-control form-control-sm', placeholder: '¿Cuál?', 'aria-label': `${entry.label}: cuál`, maxlength: '300', value: current?.detail ?? '' }))
              : null;
          const extras = h('div', { class: 'catalog-extras', hidden: !current }, severity, detail);
          box.addEventListener('change', () => {
            extras.hidden = !box.checked;
          });
          dietaryControls.push({ type, code: entry.code, box, severity, detail });
          return h('div', { class: 'catalog-item' }, h('div', { class: 'form-check' }, box, h('label', { class: 'form-check-label', for: id, text: entry.label })), extras);
        }),
      ),
    ),
  );

  /** @type {Array<{ code: string, box: HTMLInputElement, detail: HTMLInputElement | null }>} */
  const needControls = [];
  const needsGrid = h(
    'div',
    { class: 'catalog-grid' },
    catalogs.accessibilityNeeds.map((/** @type {any} */ entry) => {
      const current = p?.accessibilityNeeds?.find((/** @type {any} */ n) => n.code === entry.code);
      const id = `need-${entry.code}`;
      const box = /** @type {HTMLInputElement} */ (h('input', { class: 'form-check-input', type: 'checkbox', id, checked: Boolean(current) }));
      const detail = /** @type {HTMLInputElement} */ (
        h('input', { class: 'form-control form-control-sm', placeholder: entry.code === 'other' ? '¿Cuál?' : 'Detalle práctico (opcional)', 'aria-label': `${entry.label}: detalle`, maxlength: '300', value: current?.detail ?? '' })
      );
      const extras = h('div', { class: 'catalog-extras', hidden: !current }, detail);
      box.addEventListener('change', () => {
        extras.hidden = !box.checked;
      });
      needControls.push({ code: entry.code, box, detail });
      return h('div', { class: 'catalog-item' }, h('div', { class: 'form-check' }, box, h('label', { class: 'form-check-label', for: id, text: entry.label })), extras);
    }),
  );

  const fields = {
    givenNames: input('givenNames', { value: p?.givenNames ?? '', maxlength: '80', required: true }),
    firstSurname: input('firstSurname', { value: p?.firstSurname ?? '', maxlength: '80', required: true }),
    secondSurname: input('secondSurname', { value: p?.secondSurname ?? '', maxlength: '80' }),
    aliases: input('aliases', { value: (p?.aliases ?? []).join(', '), maxlength: '400' }),
    birthDate: input('birthDate', { type: 'date', value: p?.birthDate ?? '' }),
    age: input('age', { type: 'number', min: '0', max: '120', inputmode: 'numeric', value: p?.ageInput ?? '' }),
    phone: input('phone', { type: 'tel', value: p?.phone ?? '', maxlength: '40' }),
    email: input('email', { type: 'email', value: p?.email ?? '', maxlength: '200' }),
    attendance: h('input', { class: 'form-check-input', type: 'checkbox', id: 'attendanceConfirmed', checked: p?.attendanceConfirmed === true }),
    snores: h('select', { class: 'form-select', id: 'snores' }, catalogs.snoring.map((/** @type {any} */ s) => h('option', { value: s.code, text: s.label, selected: (p?.snores ?? 'unknown') === s.code }))),
    supports: h('textarea', { class: 'form-control', id: 'supports', rows: '2', maxlength: '1000', text: p?.supports ?? '' }),
    notes: h('textarea', { class: 'form-control', id: 'notes', rows: '3', maxlength: '2000', text: p?.notes ?? '' }),
  };
  const value = (/** @type {HTMLElement} */ el) => /** @type {HTMLInputElement} */ (el).value.trim();
  const errors = h('div', { class: 'alert alert-danger', role: 'alert', hidden: true });

  const form = h(
    'form',
    { class: 'participant-form', novalidate: true },
    errors,
    p?.nameNeedsReview
      ? h('div', { class: 'alert alert-info', role: 'status', text: 'El nombre se separó automáticamente en nombre y apellidos a partir de la lista anterior. Revisa que esté bien repartido: se usa para reconocer las cartas.' })
      : null,
    formSection(
      'Datos personales',
      h(
        'div',
        { class: 'row g-3' },
        field('col-md-4', 'givenNames', 'Nombre *', fields.givenNames, 'Si es compuesto, completo: «José Antonio».'),
        field('col-md-4', 'firstSurname', 'Primer apellido *', fields.firstSurname),
        field('col-md-4', 'secondSurname', 'Segundo apellido', fields.secondSurname),
        field('col-md-6', 'aliases', 'Apodos u otros nombres', fields.aliases, 'Separados por comas («Pepe, Josito»). Ayudan a reconocer las cartas.'),
        field('col-md-3', 'birthDate', 'Fecha de nacimiento', fields.birthDate),
        field('col-md-3', 'age', 'o edad', fields.age, 'Indica una de las dos.'),
      ),
    ),
    formSection(
      'Contacto',
      h(
        'div',
        { class: 'row g-3' },
        field('col-md-6', 'phone', 'Teléfono del participante', fields.phone),
        field('col-md-6', 'email', 'Correo electrónico', fields.email, 'Opcional. No se usa para las cartas.'),
      ),
    ),
    formSection(
      'Contacto de emergencia *',
      h(
        'div',
        {},
        h(
          'div',
          { class: 'row g-2' },
          field('col-md-5', 'ec-name-0', 'Persona de contacto *', contacts[0].name),
          field('col-md-3', 'ec-rel-0', 'Parentesco', contacts[0].relationship),
          field('col-md-4', 'ec-phone-0', 'Teléfono *', contacts[0].phone),
        ),
        secondContact,
        h('button', {
          type: 'button',
          class: 'btn btn-link btn-sm px-0 mt-1',
          text: '+ Añadir otra persona de contacto',
          hidden: !secondContact.hidden,
          onClick: (/** @type {Event} */ e) => {
            secondContact.hidden = false;
            /** @type {HTMLElement} */ (e.currentTarget).hidden = true;
          },
        }),
      ),
    ),
    formSection('Alimentación: alergias, intolerancias y dietas', h('div', {}, dietaryGroups)),
    formSection(
      'Accesibilidad y apoyos',
      h(
        'div',
        {},
        h('p', { class: 'form-text mt-0', text: 'Indica lo que necesita, no diagnósticos médicos.' }),
        needsGrid,
        h('div', { class: 'mt-3' }, field('', 'supports', 'Apoyos necesarios durante el retiro', fields.supports, 'Por ejemplo: acompañarle en los desplazamientos largos, silla en las charlas.')),
      ),
    ),
    formSection(
      'Asistencia y estancia',
      h(
        'div',
        { class: 'row g-3 align-items-end' },
        h('div', { class: 'col-md-5' }, h('div', { class: 'form-check form-switch mb-1' }, fields.attendance, h('label', { class: 'form-check-label', for: 'attendanceConfirmed', text: 'Asistencia al retiro confirmada' })), h('div', { class: 'form-text', text: 'Márcalo cuando el participante confirme que viene.' })),
        field('col-md-4', 'snores', 'Ronca', fields.snores, 'Ayuda a repartir las habitaciones.'),
      ),
    ),
    formSection('Observaciones', field('', 'notes', 'Observaciones para su estancia y participación', fields.notes, 'Solo lo que necesiten saber los organizadores. Sin diagnósticos.')),
    h(
      'div',
      { class: 'd-flex gap-2 justify-content-end form-actions' },
      h('a', { class: 'btn btn-outline-secondary', href: editing ? `#/participantes/${encodeURIComponent(p.id)}` : '#/participantes', text: 'Cancelar' }),
      h('button', { type: 'submit', class: 'btn btn-primary', text: editing ? 'Guardar cambios' : 'Registrar participante' }),
    ),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const problems = [];
    if (!value(fields.givenNames)) problems.push('el nombre');
    if (!value(fields.firstSurname)) problems.push('el primer apellido');
    if (!value(fields.birthDate) && !value(fields.age)) problems.push('la fecha de nacimiento o la edad');
    if (!value(contacts[0].name) || !value(contacts[0].phone)) problems.push('la persona de contacto de emergencia (nombre y teléfono)');
    if (problems.length > 0) {
      errors.textContent = `Falta ${problems.join(', ')}.`;
      errors.hidden = false;
      errors.scrollIntoView({ block: 'center' });
      return;
    }
    errors.hidden = true;
    const body = {
      givenNames: value(fields.givenNames),
      firstSurname: value(fields.firstSurname),
      secondSurname: value(fields.secondSurname),
      aliases: value(fields.aliases).split(',').map((a) => a.trim()).filter(Boolean),
      birthDate: value(fields.birthDate) || null,
      age: value(fields.age) === '' ? null : Number(value(fields.age)),
      phone: value(fields.phone),
      email: value(fields.email),
      emergencyContacts: contacts.map((c) => ({ name: value(c.name), relationship: value(c.relationship), phone: value(c.phone) })),
      snores: /** @type {HTMLSelectElement} */ (fields.snores).value,
      attendanceConfirmed: /** @type {HTMLInputElement} */ (fields.attendance).checked,
      dietary: dietaryControls
        .filter((c) => c.box.checked)
        .map((c) => ({ type: c.type, code: c.code, severity: c.severity?.value || null, detail: c.detail?.value.trim() || null })),
      accessibilityNeeds: needControls.filter((c) => c.box.checked).map((c) => ({ code: c.code, detail: c.detail?.value.trim() || null })),
      supports: value(fields.supports),
      notes: value(fields.notes),
    };
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    void withBusy(button, async () => {
      try {
        const result = editing ? await api.updateParticipant(p.id, body) : await api.createParticipant(body);
        const assigned = result.recompute?.assignedToParticipant ?? 0;
        toast(`${result.participant.displayName} guardado.${assigned > 0 ? ` Se le han asignado ${plural(assigned, 'carta pendiente', 'cartas pendientes')}.` : ''}`);
        window.location.hash = `#/participantes/${encodeURIComponent(result.participant.id)}`;
      } catch (error) {
        errors.textContent = /** @type {Error} */ (error).message;
        errors.hidden = false;
        errors.scrollIntoView({ block: 'center' });
      }
    });
  });

  replaceChildren(
    view,
    h('nav', { class: 'my-3', 'aria-label': 'Ruta' }, h('a', { href: editing ? `#/participantes/${encodeURIComponent(p.id)}` : '#/participantes', text: editing ? `← ${p.displayName}` : '← Participantes' })),
    h('h1', { class: 'h3 mb-3', text: editing ? `Editar: ${p.displayName}` : 'Nuevo participante' }),
    h('p', { class: 'text-body-secondary small', text: 'Los campos con * son obligatorios.' }),
    form,
  );
  /** @type {HTMLInputElement} */ (fields.givenNames).focus();
}

/**
 * @param {string} title
 * @param {HTMLElement} body
 */
function formSection(title, body) {
  return h('section', { class: 'card mb-3' }, h('div', { class: 'card-body' }, h('h2', { class: 'h6 text-uppercase text-body-secondary mb-3', text: title }), body));
}
