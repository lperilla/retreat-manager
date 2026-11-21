/**
 * Maps use-case views to the MCP output schemas (stable, compact shapes).
 */

/** @param {{ id: string, displayName: string }} ref */
const ref = (ref) => ({ id: ref.id, displayName: ref.displayName });

/**
 * @param {any} letter  Letter view from the application presenters.
 */
export function toMcpLetter(letter) {
  return {
    messageId: letter.messageId,
    receivedAt: letter.receivedAt,
    from: letter.from,
    subject: letter.subject,
    body: letter.body ?? '',
    assignment: {
      status: letter.assignment.status,
      participants: letter.assignment.participants.map(ref),
      signal: letter.assignment.signal,
      confidence: letter.assignment.confidence,
      matchedText: letter.assignment.matchedText,
      manual: letter.assignment.manual,
      suggestions: letter.assignment.suggestions.map(ref),
    },
    flags: letter.flags.map((/** @type {any} */ f) => ({ type: f.type, confidence: f.confidence, reason: f.reason })),
    attachments: letter.attachments.map((/** @type {any} */ a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })),
    isNew: letter.isNew,
  };
}

/**
 * @param {any} overview  GetDashboardOverviewUseCase result.
 */
export function toMcpSummary(overview) {
  const { kpis, sync } = overview;
  return {
    totalLetters: kpis.totalLetters,
    participantCount: kpis.participantCount,
    participantsWithLetters: kpis.participantsWithLetters,
    participantsWithoutLetters: kpis.participantsWithoutLetters,
    mostLetters: { count: kpis.mostLetters.count, participants: kpis.mostLetters.participants.map(ref) },
    fewestLetters: { count: kpis.fewestLetters.count, participants: kpis.fewestLetters.participants.map(ref) },
    zeroLetterParticipants: kpis.zeroLetterParticipants.map(ref),
    reviewQueueSize: kpis.reviewQueueSize,
    newLettersCount: kpis.newLettersCount,
    lastSyncAt: sync.lastSuccessAt,
    syncStatus: sync.status,
    lastSyncFailed: sync.lastSyncFailed,
    lastError: sync.lastError,
  };
}

/**
 * @param {any} group  GroupParticipantLettersUseCase result.
 */
export function toMcpParticipantLetters(group) {
  return {
    participant: { id: group.participant.id, displayName: group.participant.displayName, aliases: [...group.participant.aliases] },
    afterDate: group.afterDate ?? null,
    timeZone: group.timeZone,
    total: group.total,
    letters: group.letters.map(toMcpLetter),
  };
}

/**
 * @param {any} search  SearchRawLettersUseCase result.
 */
export function toMcpSearch(search) {
  return {
    query: search.query,
    total: search.total,
    results: search.results.map((/** @type {any} */ result) => {
      const { body: _body, ...letter } = toMcpLetter(result);
      return { ...letter, snippet: result.snippet, score: result.score };
    }),
  };
}

/**
 * @param {any} fresh  GetNewLettersUseCase result.
 */
export function toMcpNewLetters(fresh) {
  return {
    total: fresh.total,
    groups: fresh.groups.map((/** @type {any} */ group) => ({
      participant: ref(group.participant),
      count: group.count,
      letters: group.letters.map(toMcpLetter),
    })),
    unassigned: { count: fresh.unassigned.count, letters: fresh.unassigned.letters.map(toMcpLetter) },
  };
}

/**
 * @param {any} result  SyncResult (domain).
 * @param {Map<string, string>} names  participantId → displayName
 * @param {string | null} lastSuccessAt
 */
export function toMcpSyncResult(result, names, lastSuccessAt) {
  return {
    mode: result.mode,
    requestedMode: result.requestedMode,
    fallbackToFull: result.fallbackToFull,
    added: result.added,
    updated: result.updated,
    deleted: result.deleted,
    perParticipantDeltas: result.perParticipantDeltas.map((/** @type {any} */ delta) => ({
      participantId: delta.participantId,
      displayName: names.get(delta.participantId) ?? delta.participantId,
      newLetters: delta.newLetters,
    })),
    durationMs: result.durationMs,
    lastSuccessAt,
  };
}
