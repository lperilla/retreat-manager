/**
 * Fixed catalogs of the participants module. They are versioned with the code (stable,
 * no admin screens needed) and every entry has a free-text "otro" escape hatch.
 *
 * Only PRACTICAL information is collected: what the participant needs during the retreat,
 * never diagnoses.
 */

/** Kinds of dietary restriction. */
export const DietaryType = Object.freeze({
  ALLERGY: 'allergy',
  INTOLERANCE: 'intolerance',
  DIET: 'diet',
});

/** How careful the kitchen must be. */
export const DietarySeverity = Object.freeze({
  MILD: 'mild',
  SEVERE: 'severe',
});

/** The 14 allergens that must be declared in the EU (Regulation 1169/2011), plus "other". */
export const ALLERGENS = Object.freeze({
  gluten: 'Gluten',
  crustaceans: 'Crustáceos',
  eggs: 'Huevo',
  fish: 'Pescado',
  peanuts: 'Cacahuete',
  soy: 'Soja',
  milk: 'Leche',
  nuts: 'Frutos de cáscara',
  celery: 'Apio',
  mustard: 'Mostaza',
  sesame: 'Sésamo',
  sulphites: 'Sulfitos',
  lupin: 'Altramuz',
  molluscs: 'Moluscos',
  other: 'Otra alergia',
});

export const INTOLERANCES = Object.freeze({
  lactose: 'Lactosa',
  fructose: 'Fructosa',
  gluten: 'Gluten (sin celiaquía)',
  histamine: 'Histamina',
  other: 'Otra intolerancia',
});

export const DIETS = Object.freeze({
  gluten_free: 'Sin gluten',
  vegetarian: 'Vegetariana',
  vegan: 'Vegana',
  no_pork: 'Sin cerdo',
  low_salt: 'Baja en sal',
  diabetic: 'Sin azúcar añadido',
  soft: 'Dieta blanda / triturada',
  other: 'Otra dieta',
});

/** Practical accessibility needs (what is needed, not why). */
export const ACCESSIBILITY_NEEDS = Object.freeze({
  reduced_mobility: 'Movilidad reducida',
  wheelchair: 'Usa silla de ruedas',
  accessible_room: 'Necesita habitación accesible',
  avoid_stairs: 'Planta baja / evitar escaleras',
  transport_help: 'Ayuda en desplazamientos',
  facility_adaptation: 'Adaptación de instalaciones (baño, cama…)',
  activity_support: 'Apoyo durante las actividades',
  hearing_support: 'Apoyo auditivo',
  visual_support: 'Apoyo visual',
  other: 'Otra necesidad',
});

/** Tri-state: rooms are planned with it. */
export const Snoring = Object.freeze({
  YES: 'yes',
  NO: 'no',
  UNKNOWN: 'unknown',
});

export const ParticipantStatus = Object.freeze({
  ACTIVE: 'active',
  WITHDRAWN: 'withdrawn',
});

/** Codes allowed for each dietary type. */
export const DIETARY_CODES = Object.freeze({
  [DietaryType.ALLERGY]: ALLERGENS,
  [DietaryType.INTOLERANCE]: INTOLERANCES,
  [DietaryType.DIET]: DIETS,
});

/** Catalogs as served to the dashboard. */
export function catalogsView() {
  const list = (/** @type {Record<string, string>} */ entries) => Object.entries(entries).map(([code, label]) => ({ code, label }));
  return {
    dietary: {
      [DietaryType.ALLERGY]: list(ALLERGENS),
      [DietaryType.INTOLERANCE]: list(INTOLERANCES),
      [DietaryType.DIET]: list(DIETS),
    },
    severities: [
      { code: DietarySeverity.MILD, label: 'Leve' },
      { code: DietarySeverity.SEVERE, label: 'Grave (puede requerir medicación de urgencia)' },
    ],
    accessibilityNeeds: list(ACCESSIBILITY_NEEDS),
    snoring: [
      { code: Snoring.UNKNOWN, label: 'No consta' },
      { code: Snoring.NO, label: 'No' },
      { code: Snoring.YES, label: 'Sí' },
    ],
  };
}
