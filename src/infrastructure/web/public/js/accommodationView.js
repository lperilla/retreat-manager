/**
 * Accommodation screens: rooms and tables of the retreat, who is in each one, warnings
 * (snoring, accessibility, over capacity) and, for tables, what the kitchen must know.
 */
import { api } from './api.js';
import { $, h, replaceChildren, withBusy } from './dom.js';
import { plural } from './format.js';
import { emit } from './state.js';
import { confirmDialog, toast, toastError } from './ui.js';

/**
 * Tabs shared by the participants, rooms and tables pages.
 * @param {'participants' | 'rooms' | 'tables'} active
 */
export function sectionTabs(active) {
  const tab = (/** @type {string} */ key, /** @type {string} */ href, /** @type {string} */ label) =>
    h('li', { class: 'nav-item' }, h('a', { class: `nav-link${active === key ? ' active' : ''}`, href, 'aria-current': active === key ? 'page' : null, text: label }));
  return h('ul', { class: 'nav nav-tabs mt-3 mb-3' }, tab('participants', '#/participantes', 'Participantes'), tab('rooms', '#/habitaciones', 'Habitaciones'), tab('tables', '#/mesas', 'Mesas'));
}

/**
 * @param {'rooms' | 'tables'} kind
 */
export async function loadAccommodation(kind) {
  document.title = `${kind === 'rooms' ? 'Habitaciones' : 'Mesas'} · Gestión del retiro`;
  const data = await api.accommodation();
  const isRooms = kind === 'rooms';
  const places = isRooms ? data.rooms : data.tables;
  const without = isRooms ? data.withoutRoom : data.withoutTable;
  const capacity = isRooms ? data.totals.beds : data.totals.seats;

  replaceChildren(
    $('#view-people'),
    sectionTabs(kind),
    h(
      'div',
      { class: 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-3' },
      h(
        'div',
        {},
        h('h1', { class: 'h3 mb-0', text: isRooms ? 'Habitaciones' : 'Mesas' }),
        h('p', {
          class: 'text-body-secondary mb-0',
          text: `${plural(places.length, isRooms ? 'habitación' : 'mesa', isRooms ? 'habitaciones' : 'mesas')} · ${plural(capacity, 'plaza', 'plazas')} para ${plural(data.totals.activeParticipants, 'participante', 'participantes')}${isRooms ? '' : ' (mesa fija durante todo el retiro)'}`,
        }),
      ),
    ),
    newPlaceForm(kind),
    without.length > 0
      ? h(
          'div',
          { class: 'alert alert-info small', role: 'status' },
          h('strong', { text: `${isRooms ? 'Sin habitación' : 'Sin mesa'} (${without.length}): ` }),
          without.map((/** @type {any} */ p, /** @type {number} */ i) => [i > 0 ? ', ' : '', h('a', { href: `#/participantes/${encodeURIComponent(p.id)}`, text: p.displayName })]),
        )
      : data.totals.activeParticipants > 0
        ? h('div', { class: 'alert alert-success small', role: 'status', text: `Todos los participantes tienen ${isRooms ? 'habitación' : 'mesa'}.` })
        : null,
    places.length === 0
      ? h('p', { class: 'text-body-secondary', text: isRooms ? 'Todavía no hay habitaciones. Créalas con el formulario de arriba.' : 'Todavía no hay mesas. Créalas con el formulario de arriba.' })
      : h('div', { class: 'place-grid' }, places.map((/** @type {any} */ place) => placeCard(kind, place, without))),
  );
}

/**
 * Creates one place, or several numbered ones ("Habitación 1…20").
 * @param {'rooms' | 'tables'} kind
 */
function newPlaceForm(kind) {
  const isRooms = kind === 'rooms';
  const id = (/** @type {string} */ name) => `new-${kind}-${name}`;
  const name = h('input', { class: 'form-control form-control-sm', id: id('name'), maxlength: '80', placeholder: isRooms ? 'Habitación 1' : 'Mesa 1', required: true });
  const capacity = h('input', { class: 'form-control form-control-sm', id: id('capacity'), type: 'number', min: '1', max: '50', value: isRooms ? '2' : '8' });
  const floor = h('input', { class: 'form-control form-control-sm', id: id('floor'), maxlength: '40', placeholder: 'Planta baja, 1ª…' });
  const accessible = /** @type {HTMLInputElement} */ (h('input', { class: 'form-check-input', type: 'checkbox', id: id('accessible') }));
  const ground = /** @type {HTMLInputElement} */ (h('input', { class: 'form-check-input', type: 'checkbox', id: id('ground') }));
  const several = /** @type {HTMLInputElement} */ (h('input', { class: 'form-check-input', type: 'checkbox', id: id('several') }));
  const from = h('input', { class: 'form-control form-control-sm', id: id('from'), type: 'number', min: '1', max: '500', value: '1' });
  const to = h('input', { class: 'form-control form-control-sm', id: id('to'), type: 'number', min: '1', max: '500', value: '10' });
  const range = h(
    'div',
    { class: 'row g-2 mt-1', hidden: true },
    h('div', { class: 'col-6 col-md-2' }, h('label', { class: 'form-label small mb-1', for: id('from'), text: 'Desde el número' }), from),
    h('div', { class: 'col-6 col-md-2' }, h('label', { class: 'form-label small mb-1', for: id('to'), text: 'Hasta el número' }), to),
    h('div', { class: 'col-12 form-text', text: `Se crean «nombre + número», por ejemplo «${isRooms ? 'Habitación' : 'Mesa'} 1», «${isRooms ? 'Habitación' : 'Mesa'} 2»…` }),
  );
  several.addEventListener('change', () => {
    range.hidden = !several.checked;
    /** @type {HTMLInputElement} */ (name).placeholder = several.checked ? (isRooms ? 'Habitación' : 'Mesa') : isRooms ? 'Habitación 1' : 'Mesa 1';
  });

  const form = h(
    'form',
    { class: 'card mb-3', novalidate: true },
    h(
      'div',
      { class: 'card-body' },
      h('h2', { class: 'h6 text-uppercase text-body-secondary', text: isRooms ? 'Nueva habitación' : 'Nueva mesa' }),
      h(
        'div',
        { class: 'row g-2 align-items-end' },
        h('div', { class: isRooms ? 'col-md-3' : 'col-md-5' }, h('label', { class: 'form-label small mb-1', for: id('name'), text: 'Nombre *' }), name),
        h('div', { class: 'col-4 col-md-2' }, h('label', { class: 'form-label small mb-1', for: id('capacity'), text: isRooms ? 'Camas *' : 'Plazas *' }), capacity),
        isRooms ? h('div', { class: 'col-8 col-md-2' }, h('label', { class: 'form-label small mb-1', for: id('floor'), text: 'Planta' }), floor) : null,
        isRooms
          ? h(
              'div',
              { class: 'col-md-3 d-flex flex-wrap gap-3' },
              h('div', { class: 'form-check' }, accessible, h('label', { class: 'form-check-label', for: id('accessible'), text: 'Accesible' })),
              h('div', { class: 'form-check' }, ground, h('label', { class: 'form-check-label', for: id('ground'), text: 'Sin escaleras' })),
            )
          : null,
        h('div', { class: 'col-md-2 d-grid' }, h('button', { type: 'submit', class: 'btn btn-sm btn-primary', text: 'Crear' })),
      ),
      h('div', { class: 'form-check mt-2' }, several, h('label', { class: 'form-check-label small', for: id('several'), text: 'Crear varias numeradas' })),
      range,
    ),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const base = /** @type {HTMLInputElement} */ (name).value.trim();
    if (!base) {
      toast('Escribe el nombre.', 'warning');
      return;
    }
    const names = several.checked
      ? Array.from({ length: Math.max(0, Number(/** @type {HTMLInputElement} */ (to).value) - Number(/** @type {HTMLInputElement} */ (from).value) + 1) }, (_, i) => `${base} ${Number(/** @type {HTMLInputElement} */ (from).value) + i}`)
      : [base];
    if (names.length === 0 || names.length > 200) {
      toast('Revisa los números «desde» y «hasta» (como máximo 200).', 'warning');
      return;
    }
    const common = {
      capacity: Number(/** @type {HTMLInputElement} */ (capacity).value),
      ...(isRooms ? { floor: /** @type {HTMLInputElement} */ (floor).value, accessible: accessible.checked, groundFloor: ground.checked } : {}),
    };
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    void withBusy(button, async () => {
      let created = 0;
      try {
        for (const placeName of names) {
          if (isRooms) await api.createRoom({ ...common, name: placeName });
          else await api.createTable({ ...common, name: placeName });
          created += 1;
        }
        toast(`${plural(created, isRooms ? 'habitación creada' : 'mesa creada', isRooms ? 'habitaciones creadas' : 'mesas creadas')}.`);
      } catch (error) {
        toastError(error);
      }
      if (created > 0) emit('data-changed');
    });
  });
  return form;
}

/**
 * @param {'rooms' | 'tables'} kind
 * @param {any} place
 * @param {any[]} without  Active participants without a place of this kind.
 */
function placeCard(kind, place, without) {
  const isRooms = kind === 'rooms';
  const full = place.occupancy >= place.capacity;
  const badge = place.occupancy > place.capacity ? 'text-bg-danger' : full ? 'text-bg-secondary' : 'text-bg-success';

  const assign = async (/** @type {string} */ participantId, /** @type {string | null} */ targetId, /** @type {HTMLButtonElement} */ button) =>
    withBusy(button, async () => {
      try {
        if (isRooms) await api.assignRoom(participantId, targetId);
        else await api.assignTable(participantId, targetId);
        emit('data-changed');
      } catch (error) {
        toastError(error);
      }
    });

  const select = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { class: 'form-select form-select-sm', 'aria-label': `Añadir a ${place.name}`, disabled: full || without.length === 0 },
      h('option', { value: '', text: full ? 'Completa' : without.length === 0 ? 'No queda nadie por asignar' : 'Añadir a…' }),
      without.map((/** @type {any} */ p) => h('option', { value: p.id, text: p.displayName })),
    )
  );
  const addButton = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', text: 'Añadir', disabled: full || without.length === 0 }));
  addButton.addEventListener('click', () => {
    if (select.value) void assign(select.value, place.id, addButton);
  });

  const edit = editForm(kind, place);
  return h(
    'article',
    { class: 'card place-card' },
    h(
      'div',
      { class: 'card-body d-flex flex-column gap-2' },
      h(
        'div',
        { class: 'd-flex justify-content-between align-items-start gap-2' },
        h(
          'div',
          {},
          h('h2', { class: 'h6 mb-1', text: place.name }),
          h(
            'div',
            { class: 'd-flex flex-wrap gap-1' },
            isRooms && place.floor ? h('span', { class: 'badge text-bg-light border', text: place.floor }) : null,
            isRooms && place.accessible ? h('span', { class: 'badge text-bg-info', text: 'Accesible' }) : null,
            isRooms && place.groundFloor ? h('span', { class: 'badge text-bg-info', text: 'Sin escaleras' }) : null,
          ),
        ),
        h('span', { class: `badge ${badge}`, text: `${place.occupancy}/${place.capacity}`, title: `${place.occupancy} de ${place.capacity} plazas ocupadas` }),
      ),
      place.occupants.length === 0
        ? h('p', { class: 'small text-body-secondary mb-0', text: 'Vacía.' })
        : h(
            'ul',
            { class: 'list-unstyled mb-0 occupants' },
            place.occupants.map((/** @type {any} */ o) => {
              const remove = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-sm btn-link text-danger p-0', text: 'Quitar', 'aria-label': `Quitar a ${o.displayName} de ${place.name}` }));
              remove.addEventListener('click', () => void assign(o.id, null, remove));
              return h(
                'li',
                { class: 'd-flex justify-content-between gap-2' },
                h(
                  'span',
                  {},
                  h('a', { href: `#/participantes/${encodeURIComponent(o.id)}`, text: o.displayName }),
                  o.bed ? h('span', { class: 'small text-body-secondary', text: ` · ${o.bed}` }) : null,
                  o.snores === 'yes' ? h('span', { class: 'badge text-bg-light border ms-1', text: 'Ronca' }) : null,
                ),
                remove,
              );
            }),
          ),
      !isRooms && place.dietary.length > 0
        ? h(
            'div',
            { class: 'd-flex flex-wrap gap-1', 'aria-label': 'Alimentación en esta mesa' },
            place.dietary.map((/** @type {any} */ d) => h('span', { class: `badge ${d.severe ? 'text-bg-danger' : 'text-bg-warning'}`, text: `${d.label} × ${d.count}${d.severe ? ' (grave)' : ''}` })),
          )
        : null,
      place.warnings.length > 0 ? h('ul', { class: 'small text-danger mb-0 ps-3' }, place.warnings.map((/** @type {string} */ w) => h('li', { text: w }))) : null,
      place.notes ? h('p', { class: 'small text-body-secondary mb-0', text: place.notes }) : null,
      h('div', { class: 'd-flex gap-2' }, select, addButton),
      h(
        'div',
        { class: 'd-flex gap-2 justify-content-end' },
        h('button', { type: 'button', class: 'btn btn-sm btn-link px-0', text: 'Editar', onClick: () => (edit.hidden = !edit.hidden) }),
        h('button', {
          type: 'button',
          class: 'btn btn-sm btn-link text-danger px-0',
          text: 'Eliminar',
          disabled: place.occupancy > 0,
          title: place.occupancy > 0 ? 'Tiene personas asignadas' : `Eliminar ${place.name}`,
          onClick: (/** @type {Event} */ e) => void removePlace(kind, place, /** @type {HTMLButtonElement} */ (e.currentTarget)),
        }),
      ),
      edit,
    ),
  );
}

/**
 * @param {'rooms' | 'tables'} kind
 * @param {any} place
 */
function editForm(kind, place) {
  const isRooms = kind === 'rooms';
  const id = (/** @type {string} */ field) => `edit-${place.id}-${field}`;
  const name = h('input', { class: 'form-control form-control-sm', id: id('name'), value: place.name, maxlength: '80' });
  const capacity = h('input', { class: 'form-control form-control-sm', id: id('capacity'), type: 'number', min: '1', max: '50', value: String(place.capacity) });
  const floor = h('input', { class: 'form-control form-control-sm', id: id('floor'), value: place.floor ?? '', maxlength: '40' });
  const notes = h('input', { class: 'form-control form-control-sm', id: id('notes'), value: place.notes ?? '', maxlength: '300' });
  const accessible = /** @type {HTMLInputElement} */ (h('input', { class: 'form-check-input', type: 'checkbox', id: id('accessible'), checked: place.accessible }));
  const ground = /** @type {HTMLInputElement} */ (h('input', { class: 'form-check-input', type: 'checkbox', id: id('ground'), checked: place.groundFloor }));
  const form = h(
    'form',
    { class: 'border-top pt-2 d-flex flex-column gap-2', hidden: true, novalidate: true },
    h('label', { class: 'form-label small mb-0', for: id('name'), text: 'Nombre' }),
    name,
    h('label', { class: 'form-label small mb-0', for: id('capacity'), text: isRooms ? 'Camas' : 'Plazas' }),
    capacity,
    isRooms ? [h('label', { class: 'form-label small mb-0', for: id('floor'), text: 'Planta' }), floor] : null,
    isRooms
      ? h(
          'div',
          { class: 'd-flex gap-3' },
          h('div', { class: 'form-check' }, accessible, h('label', { class: 'form-check-label small', for: id('accessible'), text: 'Accesible' })),
          h('div', { class: 'form-check' }, ground, h('label', { class: 'form-check-label small', for: id('ground'), text: 'Sin escaleras' })),
        )
      : null,
    h('label', { class: 'form-label small mb-0', for: id('notes'), text: 'Notas' }),
    notes,
    h('button', { type: 'submit', class: 'btn btn-sm btn-primary align-self-end', text: 'Guardar' }),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const body = {
      name: /** @type {HTMLInputElement} */ (name).value,
      capacity: Number(/** @type {HTMLInputElement} */ (capacity).value),
      notes: /** @type {HTMLInputElement} */ (notes).value,
      ...(isRooms ? { floor: /** @type {HTMLInputElement} */ (floor).value, accessible: accessible.checked, groundFloor: ground.checked } : {}),
    };
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    void withBusy(button, async () => {
      try {
        if (isRooms) await api.updateRoom(place.id, body);
        else await api.updateTable(place.id, body);
        toast('Cambios guardados.');
        emit('data-changed');
      } catch (error) {
        toastError(error);
      }
    });
  });
  return form;
}

/**
 * @param {'rooms' | 'tables'} kind
 * @param {any} place
 * @param {HTMLButtonElement} button
 */
async function removePlace(kind, place, button) {
  const accepted = await confirmDialog({ title: `¿Eliminar ${place.name}?`, body: 'Se borrará definitivamente.', confirmLabel: 'Eliminar', danger: true });
  if (!accepted) return;
  await withBusy(button, async () => {
    try {
      if (kind === 'rooms') await api.deleteRoom(place.id);
      else await api.deleteTable(place.id);
      toast(`${place.name} eliminada.`);
      emit('data-changed');
    } catch (error) {
      toastError(error);
    }
  });
}

/**
 * "Habitación y mesa" block of the participant detail: selects that save on change.
 * @param {any} participant  Participant detail.
 */
export async function accommodationSection(participant) {
  const data = await api.accommodation();
  const mine = data.byParticipant[participant.id] ?? { room: null, table: null };
  const withdrawn = participant.status === 'withdrawn';

  const option = (/** @type {any} */ place, /** @type {string | undefined} */ currentId) => {
    const full = place.occupancy >= place.capacity && place.id !== currentId;
    const extras = [`${place.occupancy}/${place.capacity}`];
    if (place.accessible) extras.push('accesible');
    if (place.groundFloor) extras.push('sin escaleras');
    return h('option', { value: place.id, text: `${place.name} (${extras.join(', ')})${full ? ' · completa' : ''}`, selected: place.id === currentId, disabled: full });
  };
  const roomSelect = /** @type {HTMLSelectElement} */ (
    h('select', { class: 'form-select', id: 'participant-room', disabled: withdrawn }, h('option', { value: '', text: 'Sin habitación' }), data.rooms.map((/** @type {any} */ r) => option(r, mine.room?.id)))
  );
  const bed = /** @type {HTMLInputElement} */ (h('input', { class: 'form-control', id: 'participant-bed', maxlength: '40', placeholder: 'Cama 1, litera de arriba…', value: mine.room?.bed ?? '', disabled: withdrawn || !mine.room }));
  const tableSelect = /** @type {HTMLSelectElement} */ (
    h('select', { class: 'form-select', id: 'participant-table', disabled: withdrawn }, h('option', { value: '', text: 'Sin mesa' }), data.tables.map((/** @type {any} */ t) => option(t, mine.table?.id)))
  );

  const saveRoom = async () => {
    try {
      await api.assignRoom(participant.id, roomSelect.value || null, bed.value.trim() || null);
      bed.disabled = !roomSelect.value;
      toast(roomSelect.value ? 'Habitación guardada.' : 'Habitación liberada.');
    } catch (error) {
      toastError(error);
      emit('data-changed');
    }
  };
  roomSelect.addEventListener('change', () => void saveRoom());
  bed.addEventListener('change', () => void saveRoom());
  tableSelect.addEventListener('change', async () => {
    try {
      await api.assignTable(participant.id, tableSelect.value || null);
      toast(tableSelect.value ? 'Mesa guardada.' : 'Mesa liberada.');
    } catch (error) {
      toastError(error);
      emit('data-changed');
    }
  });

  const room = data.rooms.find((/** @type {any} */ r) => r.id === mine.room?.id);
  const table = data.tables.find((/** @type {any} */ t) => t.id === mine.table?.id);
  return h(
    'div',
    {},
    withdrawn ? h('p', { class: 'small text-body-secondary', text: 'Dado de baja: no tiene habitación ni mesa.' }) : null,
    h(
      'div',
      { class: 'row g-2' },
      h('div', { class: 'col-md-7' }, h('label', { class: 'form-label small mb-1', for: 'participant-room', text: 'Habitación' }), roomSelect),
      h('div', { class: 'col-md-5' }, h('label', { class: 'form-label small mb-1', for: 'participant-bed', text: 'Cama' }), bed),
      h('div', { class: 'col-md-7' }, h('label', { class: 'form-label small mb-1', for: 'participant-table', text: 'Mesa (fija todo el retiro)' }), tableSelect),
    ),
    room && room.occupants.length > 1
      ? h('p', { class: 'small mt-2 mb-0', text: `Comparte habitación con: ${room.occupants.filter((/** @type {any} */ o) => o.id !== participant.id).map((/** @type {any} */ o) => o.displayName).join(', ')}.` })
      : null,
    room && room.warnings.length > 0 ? h('ul', { class: 'small text-danger mb-0 mt-1 ps-3' }, room.warnings.map((/** @type {string} */ w) => h('li', { text: w }))) : null,
    table && table.occupants.length > 1
      ? h('p', { class: 'small mt-1 mb-0', text: `En su mesa: ${table.occupants.filter((/** @type {any} */ o) => o.id !== participant.id).map((/** @type {any} */ o) => o.displayName).join(', ')}.` })
      : null,
    data.rooms.length === 0 && data.tables.length === 0
      ? h('p', { class: 'small text-body-secondary mt-2 mb-0' }, 'Todavía no hay habitaciones ni mesas: créalas en ', h('a', { href: '#/habitaciones', text: 'Habitaciones' }), ' y ', h('a', { href: '#/mesas', text: 'Mesas' }), '.')
      : null,
  );
}
