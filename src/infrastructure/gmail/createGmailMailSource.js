import { GmailMailSource } from './GmailMailSource.js';
import { createGmailClient } from './googleClient.js';
import { loadAuthorizedClient } from './oauthClient.js';

/**
 * Builds the Gmail mail source from configuration. Missing credentials.json / token.json
 * raise MAIL_SOURCE_NOT_CONFIGURED (the web dashboard then offers demo mode).
 * @param {{
 *   config: import('../../composition/config.js').AppConfig,
 *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
 * }} context
 */
export async function createGmailMailSource({ config, logger }) {
  const auth = await loadAuthorizedClient({
    credentialsPath: config.gmail.credentialsPath,
    tokenPath: config.gmail.tokenPath,
    logger,
  });
  if (!config.gmail.query && !config.gmail.labelId && !config.gmail.startAt) {
    logger.warn('Neither GMAIL_QUERY, GMAIL_LABEL_ID nor GMAIL_START_DATE is set: every received message (except spam, trash, drafts and sent) will be treated as a letter');
  }
  return new GmailMailSource({
    gmail: /** @type {any} */ (createGmailClient(auth)),
    query: config.gmail.query,
    labelId: config.gmail.labelId,
    startAt: config.gmail.startAt,
    concurrency: config.gmail.concurrency,
    logger,
  });
}
