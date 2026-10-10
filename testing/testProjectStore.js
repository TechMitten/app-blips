// Desktop on-disk project store (electron/projectStore.js) and provider store
// (electron/providerStore.js). Run: node --test testing/testProjectStore.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectStore, folderNameFor, validateRow } from '../electron/projectStore.js';
import { createProviderStore } from '../electron/providerStore.js';

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
    assert.deepEqual(store.describe(), { enabled: true, id: 'openrouter', model: 'm1', baseUrl: 'https://openrouter.ai/api/v1', local: false, hasKey: true, weakEncryption: false, onboardingComplete: true });
    assert.deepEqual(store.active(), { id: 'openrouter', model: 'm1', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-secret' });

    // Reloads from disk; blank key keeps the saved one; a new provider drops it.
    const reloaded = createProviderStore({ file, crypto: fakeCrypto() });
    await reloaded.set({ model: 'm2' });
    assert.equal(reloaded.active().apiKey, 'sk-secret');

    assert.equal(reloaded.keyFor('openrouter'), 'sk-secret');
    assert.equal(reloaded.keyFor('openai'), '');
    // Unsupported providers are refused.
    for (const id of ['openai', 'zai', 'openai-compatible']) await assert.rejects(reloaded.set({ id }));
    assert.equal(reloaded.active().apiKey, 'sk-secret');

    await reloaded.clear();
    assert.equal(reloaded.describe().onboardingComplete, true);
    assert.equal(reloaded.active(), null);

    const weak = createProviderStore({ file: join(dir, 'p2.json'), crypto: fakeCrypto(false) });
    assert.equal(weak.describe().weakEncryption, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a fresh provider store needs onboarding and a legacy file does not replay it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'appblips-provider-first-run-'));
  try {
    const file = join(dir, 'provider.json');
    assert.equal(createProviderStore({ file, crypto: fakeCrypto() }).describe().onboardingComplete, false);
    await writeFile(file, JSON.stringify({ enabled: false, id: '', model: '', key: null }));
    assert.equal(createProviderStore({ file, crypto: fakeCrypto() }).describe().onboardingComplete, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local providers persist and activate without keys, dropping the previous provider key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'appblips-local-provider-'));
  try {
    const file = join(dir, 'provider.json');
    const store = createProviderStore({ file, crypto: fakeCrypto() });
    await store.set({ enabled: true, id: 'openrouter', model: 'cloud-model', apiKey: 'secret' });
    for (const id of ['lmstudio', 'ollama']) {
      await store.set({ enabled: true, id, model: 'local-coder', baseUrl: 'http://localhost:12345/v1' });
      assert.equal(store.describe().hasKey, false);
      assert.equal(store.describe().local, true);
      assert.equal(store.describe().onboardingComplete, true);
      const reloaded = createProviderStore({ file, crypto: fakeCrypto() });
      assert.deepEqual(reloaded.active(), { id, model: 'local-coder', baseUrl: 'http://localhost:12345/v1', apiKey: '' });
      await assert.rejects(reloaded.set({ id: 'openrouter' }), /API key is empty/);
      assert.equal(reloaded.active().id, id);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// --- Imported codebases (studioMode 'codebase'): blobs + project-tree mirror ---
import { createHash } from 'node:crypto';
import { utimes } from 'node:fs/promises';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const blob = (text) => ({ hash: sha(text), bytes: new TextEncoder().encode(text) });
const codebaseRow = (id, name, trees) => ({
  id,
  name,
  updatedAt: new Date().toISOString(),
  data: {
    studioMode: 'codebase',
    versions: trees.map((tree) => ({ tree, assets: {} })),
    currentVersionIndex: trees.length - 1,
  },
});

test('codebase blobs: content must match its hash; read back by id', () => withStore(async (store) => {
  await assert.rejects(store.putBlobs('1', [{ hash: sha('a'), bytes: new TextEncoder().encode('b') }]), /does not match/);
  await assert.rejects(store.putBlobs('../x', [blob('a')]), /Invalid project id/);
  await assert.rejects(store.putBlobs('1', [{ hash: 'nothex', bytes: new Uint8Array(1) }]), /Invalid blob/);
  await store.putBlobs('1', [blob('hello'), blob('world')]);
  const got = await store.getBlobs('1', [sha('hello'), sha('missing')]);
  assert.equal(got.length, 1);
  assert.equal(new TextDecoder().decode(got[0].bytes), 'hello');
  assert.equal(await store.readBlob('1', '../../etc/passwd'), null);
  assert.equal((await store.readBlob('1', sha('world'))).toString(), 'world');
}));

test('codebase: orphan blobs move in on first save; site/ is the real project tree', () => withStore(async (store, dir) => {
  const app = 'export default 1';
  const pkg = '{"name":"acme"}';
  await store.putBlobs('42', [blob(app), blob(pkg)]);
  assert.ok(existsSync(join(dir, 'app-data', 'blobs', '42', sha(app))), 'kept aside before the project has a folder');
  await store.save(codebaseRow('42', 'Acme Site', [{ 'src/App.tsx': sha(app), 'package.json': sha(pkg) }]));
  const folder = join(store.root, 'Acme Site');
  assert.ok(existsSync(join(folder, 'blobs', sha(app))));
  assert.ok(!existsSync(join(dir, 'app-data', 'blobs', '42')), 'orphan blobs adopted');
  assert.equal(await readFile(join(folder, 'site', 'src', 'App.tsx'), 'utf8'), app);
  assert.equal(await readFile(join(folder, 'site', 'package.json'), 'utf8'), pkg);
  // project.json holds hashes, not file contents
  const saved = await readFile(join(folder, 'project.json'), 'utf8');
  assert.ok(!saved.includes('export default 1'));

  // Next version drops App.tsx: only files AppBlips wrote are removed.
  await mkdir(join(folder, 'site', 'node_modules', 'react'), { recursive: true });
  await writeFile(join(folder, 'site', 'node_modules', 'react', 'index.js'), 'user installed');
  const page = 'export const About = 1';
  await store.putBlobs('42', [blob(page)]);
  await store.save(codebaseRow('42', 'Acme Site', [
    { 'src/App.tsx': sha(app), 'package.json': sha(pkg) },
    { 'src/About.tsx': sha(page), 'package.json': sha(pkg) },
  ]));
  assert.ok(!existsSync(join(folder, 'site', 'src', 'App.tsx')));
  assert.equal(await readFile(join(folder, 'site', 'src', 'About.tsx'), 'utf8'), page);
  assert.equal(await readFile(join(folder, 'site', 'node_modules', 'react', 'index.js'), 'utf8'), 'user installed');
}));

test('codebase mirror refuses paths that escape the site folder', () => withStore(async (store) => {
  const text = 'x';
  await store.putBlobs('7', [blob(text)]);
  await store.save(codebaseRow('7', 'Evil', [{ '../../outside.txt': sha(text), 'ok.txt': sha(text) }]));
  const folder = join(store.root, 'Evil');
  assert.ok(existsSync(join(folder, 'site', 'ok.txt')));
  assert.ok(!existsSync(join(store.root, 'outside.txt')));
  assert.ok(!existsSync(join(folder, 'outside.txt')));
}));

test('codebase blob GC deletes only old unreferenced blobs', () => withStore(async (store) => {
  const keep = 'keep';
  const old = 'old';
  const fresh = 'fresh';
  await store.save(codebaseRow('9', 'GC', [{ 'a.txt': sha(keep) }]));
  await store.putBlobs('9', [blob(keep), blob(old), blob(fresh)]);
  const blobs = join(store.root, 'GC', 'blobs');
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(join(blobs, sha(old)), twoHoursAgo, twoHoursAgo);
  // A new store instance has no GC throttle history.
  const again = createProjectStore({ root: store.root, orphanDir: join(store.root, '..', 'app-data') });
  await again.save(codebaseRow('9', 'GC', [{ 'a.txt': sha(keep) }]));
  assert.ok(existsSync(join(blobs, sha(keep))));
  assert.ok(existsSync(join(blobs, sha(fresh))), 'young unreferenced blob kept (its row may not be saved yet)');
  assert.ok(!existsSync(join(blobs, sha(old))));
}));
