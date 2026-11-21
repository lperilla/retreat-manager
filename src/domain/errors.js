/**
 * Typed application error shared by every layer.
 *
 * `code` is a stable English identifier; `message` is the Spanish text that may be
 * shown to staff. `httpStatus` is a transport hint used by the web adapter; the MCP
 * adapter ignores it and only forwards `{ code, message }`.
 */

/** Spanish user-facing messages, keyed by error code. */
export const ERROR_MESSAGES = Object.freeze({
  VALIDATION_ERROR: 'Los datos enviados no son válidos.',
  INVALID_PARTICIPANT: 'Los datos del participante no son válidos.',
  DUPLICATE_PARTICIPANT: 'Ya existe un participante con ese identificador.',
  PARTICIPANT_NOT_FOUND: 'Participante no encontrado.',
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
  MAIL_SOURCE_NOT_CONFIGURED: 'No hay credenciales de Gmail configuradas. Configúralas o activa el modo demostración.',
  EXPORT_NOT_FOUND: 'El archivo exportado no existe.',
  ATTACHMENT_NOT_FOUND: 'Adjunto no encontrado.',
  ATTACHMENT_BLOCKED: 'Este tipo de archivo está bloqueado por seguridad.',
  ATTACHMENT_TOO_LARGE: 'El adjunto supera el tamaño máximo permitido.',
  ATTACHMENT_NOT_PROCESSABLE: 'No se ha podido procesar el adjunto. Descárgalo para abrirlo.',
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
