// The desktop app's Surge sign-in (Publish): the account email and the API
// token Surge hands out for it. The token is encrypted with safeStorage like
// the AI key (providerStore.js) and only decrypted in the main process for
// surgeApi.js; the renderer learns the email and whether a token is saved.
//
// Same shape as keyFile.js ({ describe, keyFor, save, clear }), so
// surgeApi.js works with either. Plain Node apart from the injected `crypto`.
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { writeFileAtomic } from './projectStore.js';

export function createSurgeStore({ file, crypto }) {
  let state = { email: '', token: null }; // token: { cipher } | { plain }
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof saved?.email === 'string' && saved.token && typeof saved.token === 'object') {
      state = { email: saved.email, token: saved.token };
    }
  } catch (err) {
    // JSON.parse messages quote part of the file, which holds the token.
    if (err.code !== 'ENOENT') console.warn('[surgeStore] ignoring unreadable', file, err instanceof SyntaxError ? 'not valid JSON' : err);
  }

  const decrypt = () => {
    try {
      if (typeof state.token?.cipher === 'string') return crypto.decryptString(Buffer.from(state.token.cipher, 'base64'));
      if (typeof state.token?.plain === 'string') return state.token.plain;
    } catch (err) {
      console.warn('[surgeStore] could not decrypt the saved Surge token:', err);
    }
    return '';
  };

  return {
    describe: () => ({ id: state.email, hasKey: Boolean(state.token) }),
    keyFor: (email) => (email && email === state.email ? decrypt() : ''),
    async save(email, token) {
      state = {
        email,
        token: crypto.isEncryptionAvailable()
          ? { cipher: crypto.encryptString(token).toString('base64') }
          : { plain: token },
      };
      await writeFileAtomic(file, JSON.stringify(state, null, 2));
    },
    async clear() {
      state = { email: '', token: null };
      await rm(file, { force: true });
    },
  };
}
