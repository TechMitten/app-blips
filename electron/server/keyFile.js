// The browser version's saved API key (server.js and the Vite dev server).
// The page itself never holds a saved key: anything in the browser's storage
// is plain text that any script on AppBlips' origin, or anyone with the
// browser profile, can read. The key lives here instead, in a file only this
// user can read, and is attached to requests server-side, as the desktop app
// does from its keychain (electron/providerStore.js). The page keeps only the
// non-secret choice (provider, model, URL) and learns `hasKey`.
//
// Node has no OS keychain, so the file holds the key as-is, like .env does;
// 0600 permissions keep other accounts on the machine out.
import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// APPBLIPS_DATA_DIR moves it (the Docker image points it at a volume).
export const defaultKeyFile = (env = process.env) => join(env.APPBLIPS_DATA_DIR || join(homedir(), '.appblips'), 'provider-key.json');

export function createKeyFile({ file }) {
  let state = { id: '', key: '' };
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof saved?.id === 'string' && typeof saved.key === 'string') state = { id: saved.id, key: saved.key };
  } catch (err) {
    // JSON.parse messages quote part of the file, which holds the key.
    if (err.code !== 'ENOENT') console.warn('[keyFile] ignoring unreadable', file, err instanceof SyntaxError ? 'not valid JSON' : err.code || err);
  }

  const persist = async () => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    if (!state.key) {
      await rm(file, { force: true });
      return;
    }
    // Written beside the target and renamed, so a crash never leaves half a
    // file; mode 0600 from the start, so the key is never briefly readable.
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    // An older file keeps its old mode through rename on some systems.
    await chmod(file, 0o600).catch(() => {});
  };

  return {
    // The saved key for `id`; a key never carries over to another provider.
    keyFor: (id) => (id && id === state.id ? state.key : ''),
    describe: () => ({ id: state.id, hasKey: Boolean(state.key) }),
    async save(id, key) {
      state = { id, key };
      await persist();
    },
    async clear() {
      state = { id: '', key: '' };
      await persist();
    },
  };
}
