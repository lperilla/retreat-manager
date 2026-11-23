/**
 * Typed application error shared by every layer.
 *
 * `code` is a stable English identifier; `message` is the Spanish text that may be
 * shown to staff. `httpStatus` is a transport hint used by the web adapter.
 */

/** Spanish user-facing messages, keyed by error code. */
export const ERROR_MESSAGES = Object.freeze({
  VALIDATION_ERROR: 'Los datos enviados no son válidos.',
  INVALID_PARTICIPANT: 'Los datos del participante no son válidos.',
  DUPLICATE_PARTICIPANT: 'Ya existe un participante con ese identificador.',
  PARTICIPANT_NOT_FOUND: 'Participante no encontrado.',
  DUPLICATE_DOCUMENT: 'Ese documento de identidad ya está registrado para otro participante.',
  PARTICIPANT_INCOMPLETE: 'Faltan datos obligatorios del participante.',
  PARTICIPANT_HAS_LETTERS: 'Este participante tiene cartas asignadas: no se puede eliminar. Dalo de baja en su lugar.',
  INVALID_RETREAT: 'Los datos del retiro no son válidos.',
  PARTICIPANT_WITHDRAWN: 'El participante está dado de baja: no se le puede asignar habitación ni mesa ni confirmar su asistencia.',
  INVALID_ROOM: 'Los datos de la habitación no son válidos.',
  ROOM_NOT_FOUND: 'Habitación no encontrada.',
  ROOM_NAME_TAKEN: 'Ya existe una habitación con ese nombre.',
  ROOM_FULL: 'La habitación está completa.',
  ROOM_NOT_EMPTY: 'La habitación tiene personas asignadas: cámbialas de habitación antes de eliminarla.',
  INVALID_TABLE: 'Los datos de la mesa no son válidos.',
  TABLE_NOT_FOUND: 'Mesa no encontrada.',
  TABLE_NAME_TAKEN: 'Ya existe una mesa con ese nombre.',
  TABLE_FULL: 'La mesa está completa.',
  TABLE_NOT_EMPTY: 'La mesa tiene personas asignadas: cámbialas de mesa antes de eliminarla.',
  RETREAT_CLOSE_CONFIRMATION: 'Para cerrar el retiro escribe su nombre exactamente.',
  INVALID_LETTER: 'Los datos de la carta no son válidos.',
  LETTER_NOT_FOUND: 'Carta no encontrada.',
  INVALID_ASSIGNMENT: 'La asignación de la carta no es válida.',
  INVALID_FLAG: 'El aviso de la carta no es válido.',
  INVALID_DATE: 'La fecha indicada no es válida.',
  INVALID_TIMEZONE: 'La zona horaria configurada no es válida.',
  INVALID_SYNC_MODE: 'El modo de sincronización no es válido.',
  INVALID_SYNC_STATE: 'El estado de sincronización no es válido.',
  INVALID_PRINT_STATUS: 'El estado de impresión no es válido.',
  EMPTY_SELECTION: 'Selecciona al menos un participante.',
  SYNC_IN_PROGRESS: 'Ya hay una sincronización en curso.',
  SYNC_COOLDOWN: 'Espera unos segundos antes de volver a sincronizar.',
  SYNC_FAILED: 'La sincronización ha fallado; se muestran los últimos datos guardados.',
  UNSUPPORTED_EXPORT_FORMAT: 'El formato de exportación no está disponible.',
  CONFIG_ERROR: 'La configuración de la aplicación no es válida.',
  DATABASE_UNAVAILABLE: 'No se puede conectar con la base de datos.',
  GMAIL_AUTH_ERROR: 'Gmail ha rechazado la autenticación (credenciales caducadas o revocadas). En el ordenador servidor, ve a Configuración → Conceder permiso (o, en la app de escritorio, Archivo → Conectar con Gmail).',
  GMAIL_INSUFFICIENT_PERMISSIONS: 'El permiso concedido a Gmail no permite modificar etiquetas. En el ordenador servidor, ve a Configuración → Conceder permiso.',
  GMAIL_UNAVAILABLE: 'No se puede conectar con Gmail en este momento (red, cuota o servicio). Inténtalo de nuevo en unos minutos.',
  RESTART_UNAVAILABLE: 'La aplicación no se puede reiniciar desde aquí (no se arrancó con start.cmd). Páala y vuelve a arrancarla.',
  SETTINGS_SERVER_ONLY: 'La configuración solo se puede usar en el ordenador servidor (en la aplicación Retreat Manager).',
  GMAIL_CREDENTIALS_MISSING: 'Falta el archivo credentials.json de Google Cloud en el servidor. En la app de escritorio, usa Archivo → Conectar con Gmail para elegirlo.',
  LABELS_DISABLED: 'La sincronización de etiquetas de Gmail no está activada (GMAIL_LABELS_ENABLED=true).',
  MAIL_SOURCE_NOT_CONFIGURED: 'No hay credenciales de Gmail configuradas. Configúralas o activa el modo demostración.',
  EXPORT_NOT_FOUND: 'El archivo exportado no existe.',
  ATTACHMENT_NOT_FOUND: 'Adjunto no encontrado.',
  ATTACHMENT_BLOCKED: 'Este tipo de archivo está bloqueado por seguridad.',
  ATTACHMENT_TOO_LARGE: 'El adjunto supera el tamaño máximo permitido.',
  ATTACHMENT_NOT_PROCESSABLE: 'No se ha podido procesar el adjunto. Descárgalo para abrirlo.',
  NO_PDF_ATTACHMENTS: 'Las cartas seleccionadas no tienen PDF adjuntos.',
  ATTACHMENTS_UNAVAILABLE: 'Los adjuntos no están disponibles: falta la conexión con el correo.',
  UNAUTHORIZED: 'Acceso no autorizado. Introduce el código de acceso.',
  RATE_LIMITED: 'Demasiadas solicitudes. Espera un momento y vuelve a intentarlo.',
  ROUTE_NOT_FOUND: 'Recurso no encontrado.',
  UNSUPPORTED_MEDIA_TYPE: 'El formato de la petición no es válido.',
  PAYLOAD_TOO_LARGE: 'La petición es demasiado grande.',
  INTERNAL_ERROR: 'Se ha producido un error interno.',
});

export class AppError extends Error {
  /**
   * @param {string} code          Stable English error code, e.g. `PARTICIPANT_NOT_FOUND`.
   * @param {number} [httpStatus]  Transport hint (defaults to 400).
   * @param {string} [message]     Spanish message; defaults to the catalog entry for `code`.
   * @param {Record<string, unknown>} [details] Diagnostic details for logs (never shown verbatim).
   */
  constructor(code, httpStatus = 400, message, details) {
    super(message ?? ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details ?? null;
  }

  /** @returns {{ code: string, message: string }} */
  toJSON() {
    return { code: this.code, message: this.message };
  }
}

/**
 * @param {unknown} error
 * @returns {error is AppError}
 */
export function isAppError(error) {
  return error instanceof AppError;
}
