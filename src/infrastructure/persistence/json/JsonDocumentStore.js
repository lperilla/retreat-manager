import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const RENAME_RETRIES = 5;

/**
 * Small document collection kept in memory and, optionally, mirrored to a JSON file.
 *
 * - `filePath = null` → pure in-memory store (demo mode and tests).
 * - Writes are serialized through a promise queue and are transactional: the mutation runs
 *   on a copy of the collection, which replaces the live one only after the file has been
 *   written atomically (temp file + rename).
 * - Documents must be JSON-serializable plain objects; callers never mutate stored documents
 *   in place (they `set` new objects).
 *
 * Single-process only: two processes sharing the same files do not see each other's locks.
 */
export class JsonDocumentStore {
  /** @type {string | null} */
  #filePath;
  /** @type {string} */
  #idField;
  /** @type {Map<string, Record<string, any>> | null} */
  #documents = null;
  /** @type {Promise<Map<string, Record<string, any>>> | null} */
  #loading = null;
  /** @type {Promise<unknown>} */
  #queue = Promise.resolve();

  /**
   * @param {{ filePath?: string | null, idField: string }} options
   */
  constructor({ filePath = null, idField }) {
    this.#filePath = filePath;
    this.#idField = idField;
  }

  get filePath() {
    return this.#filePath;
  }

  /**
   * @returns {Promise<Map<string, Record<string, any>>>}
   */
  async #ensureLoaded() {
    if (this.#documents) return this.#documents;
    if (!this.#loading) this.#loading = this.#load();
    this.#documents = await this.#loading;
    return this.#documents;
  }

  /**
   * @returns {Promise<Map<string, Record<string, any>>>}
   */
  async #load() {
    /** @type {Map<string, Record<string, any>>} */
    const documents = new Map();
    if (!this.#filePath) return documents;
    let raw;
    try {
      raw = await readFile(this.#filePath, 'utf8');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return documents;
      throw error;
    }
    if (raw.trim() === '') return documents;
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.documents) ? parsed.documents : [];
    for (const document of list) {
      const id = document?.[this.#idField];
      if (typeof id === 'string' && id.length > 0) documents.set(id, document);
    }
    return documents;
  }

  /**
   * @param {Map<string, Record<string, any>>} documents
   */
  async #persist(documents) {
    if (!this.#filePath) return;
    await mkdir(dirname(this.#filePath), { recursive: true });
    const tempPath = `${this.#filePath}.${process.pid}.tmp`;
    const payload = JSON.stringify({ version: 1, documents: [...documents.values()] }, null, 2);
    await writeFile(tempPath, payload, 'utf8');
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(tempPath, this.#filePath);
        return;
      } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error).code;
        const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
        if (!retryable || attempt >= RENAME_RETRIES) {
          await rm(tempPath, { force: true });
          throw error;
        }
        await delay(25 * attempt);
      }
    }
  }

  /**
   * @template T
   * @param {(documents: ReadonlyMap<string, Record<string, any>>) => T} reader
   * @returns {Promise<T>}
   */
  async read(reader) {
    const documents = await this.#ensureLoaded();
    return reader(documents);
  }

  /**
   * @template T
   * @param {(draft: Map<string, Record<string, any>>) => T} mutation
   * @returns {Promise<T>}
   */
  write(mutation) {
    const run = async () => {
      const current = await this.#ensureLoaded();
      const draft = new Map(current);
      const result = mutation(draft);
      await this.#persist(draft);
      this.#documents = draft;
      return result;
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => {});
    return next;
  }
}

/**
 * Deep copy into JSON-compatible data (Dates become ISO strings).
 * @template T
 * @param {T} value
 * @returns {any}
 */
export function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}
