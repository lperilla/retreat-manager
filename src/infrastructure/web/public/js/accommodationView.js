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
 * Availability: "empty" (nobody yet), "partial" (some free places), "full" or "over".
 * @param {{ occupancy: number, capacity: number }} place
 */
function availability(place) {
  if (place.occupancy > place.capacity) return 'over';
  if (place.occupancy === 0) return 'empty';
  return place.occupancy < place.capacity ? 'partial' : 'full';
}

/** Room filters kept while navigating. */
const roomFilters = { floor: '', beds: '', availability: 'all' };
const NO_FLOOR = '__none__';

/** "1" → "Planta 1"; any other text is shown as written ("Planta baja", "Ático"). */
const floorLabel = (/** @type {string} */ floor) => (/^-?\d+$/.test(floor.trim()) ? `Planta ${floor.trim()}` : floor);

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
  const roomsToolbar = isRooms && places.length > 0 ? roomFiltersBar(places, () => void loadAccommodation(kind)) : null;
  const shown = isRooms ? places.filter(matchesRoomFilters) : places;

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
      : [
          roomsToolbar,
          shown.length === 0
            ? h('p', { class: 'text-body-secondary', text: 'Ninguna habitación coincide con los filtros.' })
            : h('div', { class: 'place-grid' }, shown.map((/** @type {any} */ place) => placeCard(kind, place, without))),
        ],
  );
}

/**
 * Name and phone inputs for the table leader and co-leader (servers of the retreat, not
 * participants).
 * @param {string} prefix  Unique id prefix.
 * @param {any} [table]
 */
function leaderFields(prefix, table) {
  const make = (/** @type {'leader' | 'coLeader'} */ key, /** @type {string} */ label) => {
    const name = /** @type {HTMLInputElement} */ (h('input', { class: 'form-control form-control-sm', id: `${prefix}-${key}-name`, maxlength: '120', autocomplete: 'off', value: table?.[key]?.name ?? '' }));
    const phone = /** @type {HTMLInputElement} */ (h('input', { class: 'form-control form-control-sm', id: `${prefix}-${key}-phone`, type: 'tel', maxlength: '40', autocomplete: 'off', value: table?.[key]?.phone ?? '' }));
    const element = h(
      'div',
      { class: 'row g-2' },
      h('div', { class: 'col-7' }, h('label', { class: 'form-label small mb-1', for: `${prefix}-${key}-name`, text: label }), name),
      h('div', { class: 'col-5' }, h('label', { class: 'form-label small mb-1', for: `${prefix}-${key}-phone`, text: 'Teléfono' }), phone),
    );
    return { element, value: () => ({ name: name.value.trim(), phone: phone.value.trim() }) };
  };
  const leader = make('leader', 'Líder de mesa (servidor)');
  const coLeader = make('coLeader', 'Colíder de mesa (servidor)');
  return {
    element: h('div', { class: 'd-flex flex-column gap-2' }, leader.element, coLeader.element),
    value: () => ({ leader: leader.value(), coLeader: coLeader.value() }),
  };
}

/** @param {any} room */
function matchesRoomFilters(room) {
  if (roomFilters.floor === NO_FLOOR && room.floor) return false;
  if (roomFilters.floor && roomFilters.floor !== NO_FLOOR && room.floor !== roomFilters.floor) return false;
  if (roomFilters.beds && room.capacity !== Number(roomFilters.beds)) return false;
  const state = availability(room);
  if (roomFilters.availability === 'empty') return state === 'empty';
  if (roomFilters.availability === 'free') return state === 'empty' || state === 'partial';
  if (roomFilters.availability === 'full') return state === 'full' || state === 'over';
  return true;
}

/**
 * Filters by floor, number of beds and availability, with a summary of free beds.
 * @param {any[]} rooms
 * @param {() => void} rerender
 */
function roomFiltersBar(rooms, rerender) {
  const floors = [...new Set(rooms.map((r) => r.floor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const beds = [...new Set(rooms.map((r) => r.capacity))].sort((a, b) => a - b);
  if (roomFilters.floor && roomFilters.floor !== NO_FLOOR && !floors.includes(roomFilters.floor)) roomFilters.floor = '';
  if (roomFilters.beds && !beds.includes(Number(roomFilters.beds))) roomFilters.beds = '';

  const floorSelect = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { class: 'form-select', id: 'room-floor' },
      h('option', { value: '', text: 'Todas las plantas' }),
      floors.map((f) => h('option', { value: f, text: floorLabel(f), selected: roomFilters.floor === f })),
      rooms.some((r) => !r.floor) ? h('option', { value: NO_FLOOR, text: 'Sin planta indicada', selected: roomFilters.floor === NO_FLOOR }) : null,
    )
  );
  const bedsSelect = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { class: 'form-select', id: 'room-beds' },
      h('option', { value: '', text: 'Cualquier número de camas' }),
      beds.map((n) => h('option', { value: String(n), text: plural(n, 'cama', 'camas'), selected: roomFilters.beds === String(n) })),
    )
  );
  floorSelect.addEventListener('change', () => {
    roomFilters.floor = floorSelect.value;
    rerender();
  });
  bedsSelect.addEventListener('change', () => {
    roomFilters.beds = bedsSelect.value;
    rerender();
  });

  const counts = { empty: 0, partial: 0, full: 0 };
  let freeBeds = 0;
  for (const room of rooms) {
    const state = availability(room);
    if (state === 'empty') counts.empty += 1;
    else if (state === 'partial') counts.partial += 1;
    else counts.full += 1;
    freeBeds += room.free;
  }
  const chip = (/** @type {string} */ value, /** @type {string} */ label) =>
    h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': roomFilters.availability === value ? 'true' : 'false',
      text: label,
      onClick: () => {
        roomFilters.availability = value;
        rerender();
      },
    });

  return h(
    'section',
    { class: 'card mb-3', 'aria-label': 'Filtrar habitaciones' },
    h(
      'div',
      { class: 'card-body d-flex flex-column gap-2' },
      h(
        'p',
        { class: 'availability-summary mb-1' },
        h('span', { class: 'dot is-empty', 'aria-hidden': 'true' }), `${plural(counts.empty, 'vacía', 'vacías')}`,
        h('span', { class: 'dot is-partial', 'aria-hidden': 'true' }), `${counts.partial} con camas libres`,
        h('span', { class: 'dot is-full', 'aria-hidden': 'true' }), `${plural(counts.full, 'completa', 'completas')}`,
        h('strong', { class: 'ms-2', text: `${plural(freeBeds, 'cama libre', 'camas libres')} en total` }),
      ),
      h(
        'div',
        { class: 'row g-2' },
        h('div', { class: 'col-md-6' }, h('label', { class: 'form-label small mb-1', for: 'room-floor', text: 'Planta' }), floorSelect),
        h('div', { class: 'col-md-6' }, h('label', { class: 'form-label small mb-1', for: 'room-beds', text: 'Número de camas' }), bedsSelect),
      ),
      h(
        'div',
        { class: 'filter-chips', role: 'group', 'aria-label': 'Disponibilidad' },
        chip('all', 'Todas'),
        chip('empty', `Vacías (${counts.empty})`),
        chip('free', `Con camas libres (${counts.empty + counts.partial})`),
        chip('full', `Completas (${counts.full})`),
      ),
    ),
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
  const leaders = isRooms ? null : leaderFields(`new-${kind}`);
  const leadersBlock = leaders
    ? h('div', { class: 'mt-3 pt-3 border-top' }, h('p', { class: 'small text-body-secondary mb-2', text: 'Quiénes dirigen la mesa: son servidores, no participantes.' }), leaders.element)
    : null;
  several.addEventListener('change', () => {
    range.hidden = !several.checked;
    if (leadersBlock) leadersBlock.hidden = several.checked;
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
      leadersBlock,
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
      ...(leaders && !several.checked ? leaders.value() : {}),
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
  const state = availability(place);
  const badge = { over: 'text-bg-danger', full: 'text-bg-secondary', partial: 'text-bg-warning', empty: 'text-bg-success' }[state];
  const unit = isRooms ? ['cama', 'camas'] : ['plaza', 'plazas'];
  const stateLabel = {
    over: `${place.occupancy - place.capacity} de más`,
    full: 'Completa',
    partial: `${plural(place.free, `${unit[0]} libre`, `${unit[1]} libres`)}`,
    empty: place.capacity > 1 ? `Vacía · ${plural(place.capacity, `${unit[0]} libre`, `${unit[1]} libres`)}` : 'Vacía',
  }[state];

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

  return h(
    'article',
    { class: `card place-card is-${state}` },
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
            isRooms && place.floor ? h('span', { class: 'badge text-bg-light border', text: floorLabel(place.floor) }) : null,
            isRooms && place.accessible ? h('span', { class: 'badge text-bg-info', text: 'Accesible' }) : null,
            isRooms && place.groundFloor ? h('span', { class: 'badge text-bg-info', text: 'Sin escaleras' }) : null,
          ),
        ),
        h(
          'div',
          { class: 'text-end' },
          h('span', { class: `badge availability-badge ${badge}`, text: stateLabel }),
          h('div', { class: 'occupancy small text-body-secondary', text: `${place.occupancy}/${place.capacity} ocupadas` }),
        ),
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
      !isRooms
        ? h(
            'p',
            { class: 'leaders' },
            'Líder: ',
            place.leader ? h('strong', { text: place.leader.name }) : h('span', { class: 'text-danger', text: 'sin asignar' }),
            place.leader?.phone ? ` · ${place.leader.phone}` : '',
            h('br'),
            'Colíder: ',
            place.coLeader ? h('strong', { text: place.coLeader.name }) : h('span', { class: 'text-danger', text: 'sin asignar' }),
            place.coLeader?.phone ? ` · ${place.coLeader.phone}` : '',
          )
        : null,
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
        h('button', { type: 'button', class: 'btn btn-sm btn-link px-0', text: 'Editar', 'aria-haspopup': 'dialog', onClick: () => openEditModal(kind, place) }),
        h('button', {
          type: 'button',
          class: 'btn btn-sm btn-link text-danger px-0',
          text: 'Eliminar',
          disabled: place.occupancy > 0,
          title: place.occupancy > 0 ? 'Tiene personas asignadas' : `Eliminar ${place.name}`,
          onClick: (/** @type {Event} */ e) => void removePlace(kind, place, /** @type {HTMLButtonElement} */ (e.currentTarget)),
        }),
      ),
    ),
  );
}

/** Save action of the edit dialog (the dialog is shared by rooms and tables). */
/** @type {(() => Promise<void>) | null} */
let saveEdit = null;

function editModal() {
  const modal = $('#place-modal');
  if (!modal.dataset.ready) {
    modal.dataset.ready = 'true';
    $('#place-modal-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (saveEdit) void withBusy(/** @type {HTMLButtonElement} */ ($('#place-modal-save')), saveEdit);
    });
  }
  return modal;
}

/**
 * "Editar": a dialog with the room or table data (and, for tables, its leaders).
 * @param {'rooms' | 'tables'} kind
 * @param {any} place
 */
function openEditModal(kind, place) {
  const isRooms = kind === 'rooms';
  const id = (/** @type {string} */ field) => `edit-place-${field}`;
  const name = /** @type {HTMLInputElement} */ (h('input', { class: 'form-control', id: id('name'), value: place.name, maxlength: '80', required: true }));
  const capacity = /** @type {HTMLInputElement} */ (h('input', { class: 'form-control', id: id('capacity'), type: 'number', min: '1', max: '50', value: String(place.capacity) }));
  const floor = /** @type {HTMLInputElement} */ (h('input', { class: 'form-control', id: id('floor'), value: place.floor ?? '', maxlength: '40', placeholder: 'Planta baja, 1ª…' }));
  const notes = /** @type {HTMLInputElement} */ (h('input', { class: 'form-control', id: id('notes'), value: place.notes ?? '', maxlength: '300' }));
  const accessible = /** @type {HTMLInputElement} */ (h('input', { class: 'form-check-input', type: 'checkbox', id: id('accessible'), checked: place.accessible }));
  const ground = /** @type {HTMLInputElement} */ (h('input', { class: 'form-check-input', type: 'checkbox', id: id('ground'), checked: place.groundFloor }));
  const leaders = isRooms ? null : leaderFields('edit-place', place);
  const error = h('div', { class: 'alert alert-danger py-2', role: 'alert', hidden: true });

  $('#place-modal-title').textContent = `Editar ${place.name}`;
  replaceChildren(
    $('#place-modal-body'),
    error,
    h(
      'div',
      { class: 'row g-3' },
      h('div', { class: 'col-8' }, h('label', { class: 'form-label small mb-1', for: id('name'), text: 'Nombre *' }), name),
      h('div', { class: 'col-4' }, h('label', { class: 'form-label small mb-1', for: id('capacity'), text: isRooms ? 'Camas *' : 'Plazas *' }), capacity),
      isRooms ? h('div', { class: 'col-12' }, h('label', { class: 'form-label small mb-1', for: id('floor'), text: 'Planta' }), floor) : null,
      isRooms
        ? h(
            'div',
            { class: 'col-12 d-flex gap-4' },
            h('div', { class: 'form-check' }, accessible, h('label', { class: 'form-check-label', for: id('accessible'), text: 'Accesible' })),
            h('div', { class: 'form-check' }, ground, h('label', { class: 'form-check-label', for: id('ground'), text: 'Sin escaleras' })),
          )
        : null,
      leaders
        ? h('div', { class: 'col-12 pt-2 border-top' }, h('p', { class: 'small text-body-secondary mb-2', text: 'Quiénes dirigen la mesa: son servidores, no participantes.' }), leaders.element)
        : null,
      h('div', { class: 'col-12' }, h('label', { class: 'form-label small mb-1', for: id('notes'), text: 'Notas' }), notes),
    ),
  );

  saveEdit = async () => {
    if (!name.value.trim()) {
      error.textContent = 'Escribe el nombre.';
      error.hidden = false;
      name.focus();
      return;
    }
    const body = {
      name: name.value,
      capacity: Number(capacity.value),
      notes: notes.value,
      ...(leaders ? leaders.value() : {}),
      ...(isRooms ? { floor: floor.value, accessible: accessible.checked, groundFloor: ground.checked } : {}),
    };
    try {
      if (isRooms) await api.updateRoom(place.id, body);
      else await api.updateTable(place.id, body);
      /** @type {any} */ (window).bootstrap.Modal.getOrCreateInstance(editModal()).hide();
      toast(`${body.name.trim()} guardada.`);
      emit('data-changed');
    } catch (failure) {
      error.textContent = /** @type {Error} */ (failure).message;
      error.hidden = false;
    }
  };

  const modal = editModal();
  modal.addEventListener('shown.bs.modal', () => name.focus(), { once: true });
  /** @type {any} */ (window).bootstrap.Modal.getOrCreateInstance(modal).show();
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
