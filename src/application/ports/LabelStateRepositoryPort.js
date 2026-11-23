import { definePort } from './definePort.js';

/**
 * @typedef {import('../../domain/entities/MailLabelState.js').MailLabelState} MailLabelState
 *
 * @typedef {Object} LabelStateRepositoryPort
 * @property {() => Promise<MailLabelState[]>} findAll
 * @property {(messageIds: string[]) => Promise<MailLabelState[]>} findByMessageIds
 * @property {(states: MailLabelState[]) => Promise<void>} saveMany
 * @property {() => Promise<number>} deleteAll
 */
export const LabelStateRepositoryPort = definePort('LabelStateRepositoryPort', ['findAll', 'findByMessageIds', 'saveMany', 'deleteAll']);
