// Tiny JSON-file store. Everything lives in memory and is written to
// data/db.json after each change (temp file + rename, so a crash never
// leaves a half-written file). Writes are serialised.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function createStore(dir) {
  const file = path.join(dir, 'db.json');
  await mkdir(dir, { recursive: true });

  let data = {};
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Could not read ${file}: ${err.message}`);
  }

  let queue = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(data, null, 2);
    queue = queue.then(async () => {
      const tmp = `${file}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, file);
    });
    return queue;
  };

  return {
    get(key, fallback) {
      return key in data ? data[key] : structuredClone(fallback);
    },
    async set(key, value) {
      data[key] = value;
      await persist();
      return value;
    },
    // Read-modify-write: fn receives the current value (or fallback) and
    // returns the new one.
    async update(key, fallback, fn) {
      const next = await fn(this.get(key, fallback));
      return this.set(key, next);
    },
  };
}
