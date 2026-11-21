/**
 * Domain-wide enumerations and default tuning values.
 * Pure data module: no I/O and no framework imports.
 */

/** @enum {string} */
export const AssignmentStatus = Object.freeze({
  /** Assigned to one or more participants (automatically or manually). */
  ASSIGNED: 'ASSIGNED',
  /** The heuristics could not decide; staff must review it. */
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  /** Staff explicitly decided the letter belongs to nobody. */
  UNASSIGNED: 'UNASSIGNED',
});

/** @enum {string} */
export const SignalType = Object.freeze({
  SUBJECT_EXPLICIT: 'SUBJECT_EXPLICIT',
  BODY_EXPLICIT: 'BODY_EXPLICIT',
  NAME_MENTION: 'NAME_MENTION',
  MANUAL: 'MANUAL',
});

/** Confidence attached to each signal type. */
export const SIGNAL_CONFIDENCE = Object.freeze({
  [SignalType.SUBJECT_EXPLICIT]: 0.95,
  [SignalType.BODY_EXPLICIT]: 0.85,
  [SignalType.NAME_MENTION]: 0.3,
  [SignalType.MANUAL]: 1,
});

/** Signal types that count as an explicit recipient designation. */
export const EXPLICIT_SIGNALS = Object.freeze([SignalType.SUBJECT_EXPLICIT, SignalType.BODY_EXPLICIT]);

/** @enum {string} */
export const FlagType = Object.freeze({
  AUTO_REPLY: 'AUTO_REPLY',
  NEWSLETTER_OR_BULK: 'NEWSLETTER_OR_BULK',
  MAILER_DAEMON: 'MAILER_DAEMON',
  SIGNATURE_ONLY: 'SIGNATURE_ONLY',
  ATTACHMENT_ONLY: 'ATTACHMENT_ONLY',
  MULTI_RECIPIENT: 'MULTI_RECIPIENT',
  HAS_ATTACHMENTS: 'HAS_ATTACHMENTS',
});

/** Stable output order for flags. */
export const FLAG_ORDER = Object.freeze([
  FlagType.AUTO_REPLY,
  FlagType.NEWSLETTER_OR_BULK,
  FlagType.MAILER_DAEMON,
  FlagType.SIGNATURE_ONLY,
  FlagType.ATTACHMENT_ONLY,
  FlagType.MULTI_RECIPIENT,
  FlagType.HAS_ATTACHMENTS,
]);

/**
 * Flags that represent a warning for staff ("con avisos" filter).
 * MULTI_RECIPIENT and HAS_ATTACHMENTS are informational only.
 */
export const WARNING_FLAG_TYPES = Object.freeze([
  FlagType.AUTO_REPLY,
  FlagType.NEWSLETTER_OR_BULK,
  FlagType.MAILER_DAEMON,
  FlagType.SIGNATURE_ONLY,
  FlagType.ATTACHMENT_ONLY,
]);

/** @enum {string} */
export const SyncMode = Object.freeze({
  INCREMENTAL: 'incremental',
  FULL: 'full',
});

/** @enum {string} */
export const SyncStatus = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  FAILED: 'failed',
});

/** @enum {string} */
export const SyncRunStatus = Object.freeze({
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
});

/** @enum {string} */
export const PrintStatusValue = Object.freeze({
  PENDING: 'pending',
  PRINTED: 'printed',
});

/** Identifier of the single sync state document. */
export const SYNC_STATE_ID = 'gmail';

/** Default tuning values; the composition root may override them from the environment. */
export const DEFAULTS = Object.freeze({
  ASSIGNMENT_MIN_CONFIDENCE: 0.75,
  ASSIGNMENT_MARGIN: 0.15,
  BODY_SCAN_CHARS: 600,
  TIME_ZONE: 'Europe/Madrid',
  SIGNATURE_ONLY_MAX_CHARS: 20,
  SYNC_MIN_INTERVAL_SECONDS: 30,
  SYNC_LOCK_TTL_SECONDS: 300,
});

/** Locale used for user-facing formatting. */
export const LOCALE = 'es-ES';

/** Locale used for name collation (`localeCompare`). */
export const COLLATION_LOCALE = 'es';
