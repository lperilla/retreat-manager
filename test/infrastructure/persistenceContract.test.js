import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJsonPersistence } from '../../src/infrastructure/persistence/json/createJsonPersistence.js';
import { definePersistenceContract } from '../helpers/persistenceContract.js';

definePersistenceContract('in-memory', async (clock) => ({
  clock,
  persistence: createJsonPersistence({ directory: null, clock }),
}));

definePersistenceContract('json files', async (clock) => {
  const directory = await mkdtemp(join(tmpdir(), 'retreat-contract-'));
  return {
    clock,
    persistence: createJsonPersistence({ directory, clock }),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
});
