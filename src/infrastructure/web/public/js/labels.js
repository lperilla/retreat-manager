/** Spanish labels for codes coming from the API. */

export const FLAG_LABELS = Object.freeze({
  AUTO_REPLY: 'Respuesta automática',
  NEWSLETTER_OR_BULK: 'Envío masivo',
  MAILER_DAEMON: 'Error de entrega',
  SIGNATURE_ONLY: 'Solo firma',
  ATTACHMENT_ONLY: 'Solo adjuntos',
  MULTI_RECIPIENT: 'Varios destinatarios',
  HAS_ATTACHMENTS: 'Con adjuntos',
});

/** Informational flags are shown in grey; the rest are warnings. */
export const INFO_FLAGS = new Set(['MULTI_RECIPIENT', 'HAS_ATTACHMENTS']);

export const SIGNAL_LABELS = Object.freeze({
  SUBJECT_EXPLICIT: 'Asunto',
  BODY_EXPLICIT: 'Cuerpo',
  NAME_MENTION: 'Mención',
  MANUAL: 'Manual',
});

export const ASSIGNMENT_STATUS_LABELS = Object.freeze({
  ASSIGNED: 'Asignada',
  NEEDS_REVIEW: 'Por revisar',
  UNASSIGNED: 'Sin asignar',
});

export const RUN_STATUS_LABELS = Object.freeze({
  success: 'Correcta',
  failed: 'Con error',
  running: 'En curso',
});

export const RUN_TYPE_LABELS = Object.freeze({
  incremental: 'Incremental',
  full: 'Completa',
});
