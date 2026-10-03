// Desktop on-disk project store (electron/projectStore.js) and provider store
// (electron/providerStore.js). Run: node --test testing/testProjectStore.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectStore, folderNameFor, validateRow } from '../electron/projectStore.js';
import { createProviderStore, providerEnv } from '../electron/providerStore.js';

const row = (id, name, extra = {}) => ({
  id,
  name,
  updatedAt: extra.updatedAt || new Date().toISOString(),
  data: {
    versions: extra.versions || [{ files: { 'index.html': `<h1>${name}</h1>` } }],
    currentVersionIndex: 0,
  },
});

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'appblips-store-'));
  const store = createProjectStore({ root: join(dir, 'Projects'), orphanDir: join(dir, 'app-data') });
  try {
    await fn(store, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('folder names are valid on every OS', () => {
  assert.equal(folderNameFor('My Todo App'), 'My Todo App');
  assert.equal(folderNameFor('a/b\\c:d*e?"f<g>h|i'), 'abcdefghi');
  assert.equal(folderNameFor('  spaced   out  '), 'spaced out');
  assert.equal(folderNameFor('trailing dots...'), 'trailing dots');
  assert.equal(folderNameFor('CON'), 'CON_');
  assert.equal(folderNameFor('..'), 'Untitled app');
  assert.equal(folderNameFor(''), 'Untitled app');
  assert.equal(folderNameFor('x'.repeat(200)).length, 80);
});

test('rows from IPC are validated, ids cannot traverse paths', () => {
  assert.equal(validateRow(row('123', 'ok')), null);
  assert.ok(validateRow(row('../evil', 'x')));
  assert.ok(validateRow(row('a/b', 'x')));
  assert.ok(validateRow({ id: '1', name: 'x', data: [] }));
  assert.ok(validateRow(null));
});

test('save writes project.json and the site mirror; list reads it back', () => withStore(async (store) => {
  await store.save(row('1', 'My App'));
  const dir = join(store.root, 'My App');
  assert.ok(existsSync(join(dir, 'project.json')));
  assert.equal(await readFile(join(dir, 'site', 'index.html'), 'utf8'), '<h1>My App</h1>');
  const [{ row: loaded, appData }] = await store.list();
  assert.equal(loaded.id, '1');
  assert.equal(appData, null);
  // no temp files left behind
  assert.deepEqual((await readdir(dir)).sort(), ['project.json', 'site']);
}));

test('legacy code-only versions mirror as index.html; removed pages are pruned', () => withStore(async (store) => {
  await store.save(row('1', 'Site', { versions: [{ files: { 'index.html': 'a', 'about.html': 'b' } }] }));
  const site = join(store.root, 'Site', 'site');
  assert.deepEqual((await readdir(site)).sort(), ['about.html', 'index.html']);
  await store.save(row('1', 'Site', { versions: [{ code: 'legacy' }] }));
  assert.deepEqual(await readdir(site), ['index.html']);
  assert.equal(await readFile(join(site, 'index.html'), 'utf8'), 'legacy');
}));

test('name collisions get a suffix; renaming moves the folder', () => withStore(async (store) => {
  await store.save(row('1', 'Game'));
  await store.save(row('2', 'Game'));
  assert.deepEqual((await readdir(store.root)).sort(), ['Game', 'Game (2)']);
  await store.save(row('2', 'Racer'));
  assert.deepEqual((await readdir(store.root)).sort(), ['Game', 'Racer']);
  // Re-saving under the same name keeps the folder (also case-only changes).
  await store.save(row('1', 'game'));
  assert.deepEqual((await readdir(store.root)).sort(), ['Racer', 'game']);
}));

test('app data follows the project: orphan first, adopted on first save', () => withStore(async (store, dir) => {
  await store.saveAppData('draft', { score: '1' });
  await store.saveAppData('7', { score: '2' });
  assert.ok(existsSync(join(dir, 'app-data', '7.json')));
  // Same queue: the save lands before the app data write that follows it.
  const saving = store.save(row('7', 'Seven'));
  const writing = store.saveAppData('7', { score: '3' });
  await Promise.all([saving, writing]);
  assert.ok(!existsSync(join(dir, 'app-data', '7.json')));
  assert.deepEqual(JSON.parse(await readFile(join(store.root, 'Seven', 'app-data.json'), 'utf8')), { score: '3' });
  assert.deepEqual(await store.orphanAppData(), { draft: { score: '1' } });
  await store.saveAppData('7', null);
  assert.ok(!existsSync(join(store.root, 'Seven', 'app-data.json')));
}));

test('remove deletes the folder (via trash when provided)', () => withStore(async (store, dir) => {
  const trashed = [];
  const withTrash = createProjectStore({ root: store.root, orphanDir: join(dir, 'app-data'), trash: async (p) => { trashed.push(p); await rm(p, { recursive: true }); } });
  await withTrash.save(row('1', 'Doomed'));
  await withTrash.remove('1');
  assert.equal(trashed.length, 1);
  assert.deepEqual(await readdir(withTrash.root), []);
  await assert.rejects(withTrash.remove('../x'));
}));

test('scan ignores junk and keeps the newer of two copies of a project', () => withStore(async (store) => {
  await store.save(row('1', 'Original', { updatedAt: '2026-01-01T00:00:00.000Z' }));
  const copy = join(store.root, 'Copy');
  await mkdir(copy, { recursive: true });
  await writeFile(join(copy, 'project.json'), JSON.stringify(row('1', 'Copy', { updatedAt: '2026-05-01T00:00:00.000Z' })));
  await mkdir(join(store.root, 'Not a project'));
  await writeFile(join(store.root, 'stray.txt'), 'hi');
  const projects = await store.list();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].row.name, 'Copy');
}));

test('changeRoot can move every project to a new folder', () => withStore(async (store, dir) => {
  await store.save(row('1', 'One'));
  await store.save(row('2', 'Two'));
  const target = join(dir, 'Elsewhere');
  await mkdir(join(target, 'One'), { recursive: true }); // name already taken there
  const moved = await store.changeRoot(target, { move: true });
  assert.equal(moved, 2);
  assert.equal(store.root, target);
  assert.deepEqual((await readdir(target)).sort(), ['One', 'One (2)', 'Two']);
  assert.deepEqual((await store.list()).map((p) => p.row.id).sort(), ['1', '2']);
}));

// A stand-in for Electron's safeStorage.
const fakeCrypto = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().replace(/^enc:/, ''),
  getSelectedStorageBackend: () => 'gnome_libsecret',
});

test('provider store encrypts the key and never describes it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'appblips-provider-'));
  try {
    const file = join(dir, 'provider.json');
    const store = createProviderStore({ file, crypto: fakeCrypto() });
    assert.equal(store.active(), null);
    await store.set({ enabled: true, id: 'openrouter', model: ' m1 ', apiKey: 'sk-secret' });
    const onDisk = await readFile(file, 'utf8');
    assert.ok(!onDisk.includes('sk-secret'));
    assert.deepEqual(store.describe(), { enabled: true, id: 'openrouter', model: 'm1', hasKey: true, weakEncryption: false });
    assert.deepEqual(store.active(), { id: 'openrouter', model: 'm1', apiKey: 'sk-secret' });

    // Reloads from disk; blank key keeps the saved one; a new provider drops it.
    const reloaded = createProviderStore({ file, crypto: fakeCrypto() });
    await reloaded.set({ model: 'm2' });
    assert.equal(reloaded.active().apiKey, 'sk-secret');
    assert.equal(reloaded.keyFor('openrouter'), 'sk-secret');
    assert.equal(reloaded.keyFor('openai'), '');
    await reloaded.set({ id: 'openai' });
    assert.equal(reloaded.describe().hasKey, false);
    assert.equal(reloaded.active(), null);
    await assert.rejects(reloaded.set({ id: 'openai-compatible' }));

    const weak = createProviderStore({ file: join(dir, 'p2.json'), crypto: fakeCrypto(false) });
    assert.equal(weak.describe().weakEncryption, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('providerEnv points both relays at the saved provider', () => {
  const base = { OPENAI_BASE_URL: 'http://operator', APPBLIPS_ZAI_MODEL: 'old', KEEP: '1' };
  assert.equal(providerEnv(base, null), base);
  const env = providerEnv(base, { id: 'zai', model: 'glm', apiKey: 'k' });
  assert.equal(env.OPENAI_LLM_PROVIDER, 'zai');
  assert.equal(env.APPBLIPS_ZAI_API_KEY, 'k');
  assert.equal(env.OPENAI_LLM_MODEL, 'glm');
  assert.equal(env.OPENAI_BASE_URL, undefined);
  assert.equal(env.APPBLIPS_ZAI_MODEL, undefined);
  assert.equal(env.KEEP, '1');
});

test('providerEnv maps hyphenated provider ids to valid variable names', () => {
  const env = providerEnv({}, { id: 'zai-coding', model: 'glm-5.3', apiKey: 'k' });
  assert.equal(env.OPENAI_LLM_PROVIDER, 'zai-coding');
  assert.equal(env.APPBLIPS_ZAI_CODING_API_KEY, 'k');
});
