/**
 * Zod input and output schemas of the MCP tools (raw shapes, as expected by registerTool).
 */
import { z } from 'zod';

const participantRef = z.object({ id: z.string(), displayName: z.string() });
const flag = z.object({ type: z.string(), confidence: z.number(), reason: z.string() });
const attachment = z.object({ filename: z.string(), mimeType: z.string(), size: z.number() });
const tie = z.object({ count: z.number().int(), participants: z.array(participantRef) });

const assignment = z.object({
  status: z.enum(['ASSIGNED', 'NEEDS_REVIEW', 'UNASSIGNED']),
  participants: z.array(participantRef),
  signal: z.string().nullable(),
  confidence: z.number(),
  matchedText: z.string(),
  manual: z.boolean(),
  suggestions: z.array(participantRef),
});

export const letterSchema = z.object({
  messageId: z.string(),
  receivedAt: z.string().describe('ISO-8601 instant'),
  from: z.string(),
  subject: z.string(),
  body: z.string().describe('Full plain-text body (never truncated)'),
  assignment,
  flags: z.array(flag),
  attachments: z.array(attachment),
  isNew: z.boolean().describe('Not yet seen by staff'),
});

const searchResult = letterSchema.omit({ body: true }).extend({
  snippet: z.string(),
  score: z.number(),
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const groupParticipantLettersInput = {
  participantId: z.string().min(1).max(200).describe('Participant slug, e.g. "maria-garcia"'),
  afterDate: z
    .string()
    .max(40)
    .optional()
    .describe('Optional EXCLUSIVE lower bound: "YYYY-MM-DD" (local day in the configured time zone) or an ISO date-time'),
};

export const searchRawLettersInput = {
  query: z.string().min(2).max(200).describe('Words to find in subject, sender or body (accent-insensitive; all words must match)'),
  limit: z.number().int().min(1).max(50).optional().describe('Maximum results (1-50, default 20)'),
};

export const listNewLettersInput = {
  participantId: z.string().min(1).max(200).optional().describe('Restrict to one participant'),
};

export const syncMailboxInput = {
  mode: z
    .enum(['incremental', 'full'])
    .optional()
    .describe('"incremental" (default) fetches only changes since the last sync; "full" re-lists the whole query'),
};

export const exportBatchLettersInput = {
  participantIds: z.array(z.string().min(1).max(200)).min(1).max(500).describe('Participant slugs to export'),
  format: z.enum(['html', 'txt', 'json']).describe('"html" = printable packet (page break per participant)'),
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export const summaryOutput = {
  totalLetters: z.number().int(),
  participantCount: z.number().int(),
  participantsWithLetters: z.number().int(),
  participantsWithoutLetters: z.number().int(),
  mostLetters: tie.describe('ALL participants tied for the most letters'),
  fewestLetters: tie.describe('ALL participants tied for the fewest letters (0-letter participants included)'),
  zeroLetterParticipants: z.array(participantRef),
  reviewQueueSize: z.number().int(),
  newLettersCount: z.number().int(),
  lastSyncAt: z.string().nullable(),
  syncStatus: z.enum(['idle', 'running', 'failed']),
  lastSyncFailed: z.boolean(),
  lastError: z.string().nullable(),
};

export const groupParticipantLettersOutput = {
  participant: z.object({ id: z.string(), displayName: z.string(), aliases: z.array(z.string()) }),
  afterDate: z.string().nullable(),
  timeZone: z.string(),
  total: z.number().int(),
  letters: z.array(letterSchema),
};

export const searchRawLettersOutput = {
  query: z.string(),
  total: z.number().int(),
  results: z.array(searchResult),
};

export const listNewLettersOutput = {
  total: z.number().int(),
  groups: z.array(z.object({ participant: participantRef, count: z.number().int(), letters: z.array(letterSchema) })),
  unassigned: z.object({ count: z.number().int(), letters: z.array(letterSchema) }),
};

export const syncMailboxOutput = {
  mode: z.enum(['incremental', 'full']),
  requestedMode: z.enum(['incremental', 'full']),
  fallbackToFull: z.boolean(),
  added: z.number().int(),
  updated: z.number().int(),
  deleted: z.number().int(),
  perParticipantDeltas: z.array(z.object({ participantId: z.string(), displayName: z.string(), newLetters: z.number().int() })),
  durationMs: z.number().int(),
  lastSuccessAt: z.string().nullable(),
};

export const exportBatchLettersOutput = {
  filePath: z.string().describe('Absolute path of the file written under EXPORT_DIR'),
  filename: z.string(),
  format: z.enum(['html', 'txt', 'json']),
  participantCount: z.number().int(),
  letterCount: z.number().int(),
};
