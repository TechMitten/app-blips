// On-disk project store for the desktop app. Plain Node (no Electron imports)
// so testing/testProjectStore.js can drive it against a temp directory.
//
// Layout under the projects root (a visible folder the user can change):
//
//   <Project Name>/
//     project.json   the same row the web build keeps in localStorage['orion-projects']:
//                    { id, name, updatedAt, data: { versions, currentVersionIndex, ... } }
//     app-data.json  the generated app's own localStorage (lib/previewStorage.js)
//     site/*.html    the current version's pages, rewritten on every save. A
//                    read-only convenience copy: project.json is the source of truth.
//
// The renderer only ever names a project by id; folder names are derived here
// from the project name and never accepted from IPC. App data for an id with no
// folder yet ('draft', or a project mid-first-save) lives in `orphanDir`.
// Every operation on one id runs through that id's queue, so a project save and
// the app-data migration that follows it land on disk in the order they were sent.
import { mkdir, readdir, readFile, rename, rm, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { versionFiles, validatePageName, MAX_PAGES } from '../src/lib/pages.js';

export const PROJECT_FILE = 'project.json';
export const APP_DATA_FILE = 'app-data.json';
export const SITE_DIR = 'site';

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_NAME_LENGTH = 200;
const MAX_FOLDER_NAME_LENGTH = 80;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const isValidProjectId = (id) => typeof id === 'string' && ID_RE.test(id);

// A folder name that is valid on Windows, macOS and Linux.
export function folderNameFor(name) {
  let clean = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FOLDER_NAME_LENGTH)
    .replace(/[. ]+$/, '');
  if (!clean || /^\.+$/.test(clean)) clean = 'Untitled app';
  if (WINDOWS_RESERVED.test(clean)) clean = `${clean}_`;
  return clean;
}

const sameFolder = (a, b) => a.toLowerCase() === b.toLowerCase();

export function validateRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'Project must be an object.';
  if (!isValidProjectId(row.id)) return 'Invalid project id.';
  if (typeof row.name !== 'string' || row.name.length > MAX_NAME_LENGTH) return 'Invalid project name.';
  if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) return 'Invalid project data.';
  if (row.updatedAt != null && typeof row.updatedAt !== 'string') return 'Invalid updatedAt.';
  return null;
}

const sanitizeAppData = (map) => {
  const clean = {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) return clean;
  for (const [key, value] of Object.entries(map)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    clean[key] = String(value ?? '');
  }
  return clean;
};

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

// Write to a temp file, then rename over the target, so a crash mid-write never
// leaves a truncated project.json. Windows can briefly refuse the rename while
// an indexer or antivirus holds the target open, hence the retries.
export async function writeFileAtomic(file, contents) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) {
        await rm(tmp, { force: true });
        throw err;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

// Directory moves across drives fail with EXDEV; fall back to copy + delete.
async function moveDir(from, to) {
  try {
    await rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await cp(from, to, { recursive: true, errorOnExist: true });
    await rm(from, { recursive: true, force: true });
  }
}

export function createProjectStore({ root, orphanDir, trash } = {}) {
  let projectsRoot = resolve(root);
  const orphanRoot = resolve(orphanDir);
  const folders = new Map(); // id -> folder name under projectsRoot
  const queues = new Map(); // id -> tail promise
  let scanned = false;

  const enqueue = (id, task) => {
    const run = (queues.get(id) || Promise.resolve()).catch(() => {}).then(task);
    const tail = run.catch(() => {});
    queues.set(id, tail);
    tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
    return run;
  };

  const folderPath = (folder) => {
    const full = resolve(projectsRoot, folder);
    if (!full.startsWith(projectsRoot + sep)) throw new Error('Project folder escapes the projects root.');
    return full;
  };
  const orphanPath = (id) => join(orphanRoot, `${id}.json`);

  const uniqueFolder = (name, ownFolder) => {
    const base = folderNameFor(name);
    for (let n = 1; ; n += 1) {
      const candidate = n === 1 ? base : `${base} (${n})`;
      if (ownFolder && sameFolder(candidate, ownFolder)) return candidate;
      const takenInMemory = [...folders.values()].some((f) => sameFolder(f, candidate));
      if (!takenInMemory && !existsSync(join(projectsRoot, candidate))) return candidate;
    }
  };

  async function scan() {
    folders.clear();
    await mkdir(projectsRoot, { recursive: true });
    const seen = new Map(); // id -> updatedAt of the folder kept
    const entries = await readdir(projectsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let row;
      try {
        row = await readJson(join(projectsRoot, entry.name, PROJECT_FILE));
      } catch {
        continue; // not a project folder, or unreadable
      }
      if (validateRow(row)) continue;
      // A folder copied by hand keeps its id; the newer copy wins.
      const prev = seen.get(row.id);
      if (prev !== undefined && String(prev) >= String(row.updatedAt || '')) continue;
      seen.set(row.id, row.updatedAt || '');
      folders.set(row.id, entry.name);
    }
    scanned = true;
  }

  const ensureScanned = async () => { if (!scanned) await scan(); };

  // Resolves once every queued write has finished.
  const flush = async () => {
    while (queues.size) await Promise.all([...queues.values()]);
  };

  async function readAppData(id) {
    const folder = folders.get(id);
    const file = folder ? join(folderPath(folder), APP_DATA_FILE) : orphanPath(id);
    try {
      return sanitizeAppData(await readJson(file));
    } catch {
      return null;
    }
  }

  // Mirror of the current version's pages. Stale .html files from removed
  // pages are deleted; anything else a user put in site/ is left alone.
  async function writeSiteMirror(dir, row) {
    const versions = Array.isArray(row.data.versions) ? row.data.versions : [];
    const index = Number.isInteger(row.data.currentVersionIndex) ? row.data.currentVersionIndex : versions.length - 1;
    const version = versions[index] || versions[versions.length - 1];
    if (!version) return;
    const files = versionFiles(version);
    const names = Object.keys(files).filter((name) => validatePageName(name) && typeof files[name] === 'string').slice(0, MAX_PAGES);
    if (!names.length) return;
    const siteDir = join(dir, SITE_DIR);
    await mkdir(siteDir, { recursive: true });
    for (const existing of await readdir(siteDir)) {
      if (existing.endsWith('.html') && !names.includes(existing)) await rm(join(siteDir, existing), { force: true });
    }
    for (const name of names) await writeFileAtomic(join(siteDir, name), files[name]);
  }

  return {
    get root() { return projectsRoot; },

    // Waits for queued writes first, so a renderer reload right after a save
    // (e.g. after an import) reads what was just written.
    async list() {
      await flush();
      await scan();
      const projects = [];
      for (const [id, folder] of folders) {
        try {
          const row = await readJson(join(folderPath(folder), PROJECT_FILE));
          projects.push({ row, appData: await readAppData(id) });
        } catch (err) {
          console.warn('[projectStore] skipping unreadable project', folder, err.message);
        }
      }
      return projects;
    },

    // App data for ids that have no folder (the unsaved 'draft').
    async orphanAppData() {
      const out = {};
      let names = [];
      try { names = await readdir(orphanRoot); } catch { return out; }
      for (const name of names) {
        const id = name.replace(/\.json$/, '');
        if (!name.endsWith('.json') || !isValidProjectId(id) || folders.has(id)) continue;
        try { out[id] = sanitizeAppData(await readJson(join(orphanRoot, name))); } catch { /* skip */ }
      }
      return out;
    },

    save(row) {
      const problem = validateRow(row);
      if (problem) return Promise.reject(new Error(problem));
      return enqueue(row.id, async () => {
        await ensureScanned();
        const current = folders.get(row.id);
        const wanted = uniqueFolder(row.name, current);
        if (current && current !== wanted) {
          await moveDir(folderPath(current), folderPath(wanted));
        }
        folders.set(row.id, wanted);
        const dir = folderPath(wanted);
        await mkdir(dir, { recursive: true });
        await writeFileAtomic(join(dir, PROJECT_FILE), JSON.stringify(row, null, 2));
        // First save of a project: adopt app data written while it had no folder.
        if (!current && existsSync(orphanPath(row.id))) {
          await rename(orphanPath(row.id), join(dir, APP_DATA_FILE)).catch(() => {});
        }
        await writeSiteMirror(dir, row);
      });
    },

    remove(id) {
      if (!isValidProjectId(id)) return Promise.reject(new Error('Invalid project id.'));
      return enqueue(id, async () => {
        await ensureScanned();
        await rm(orphanPath(id), { force: true });
        const folder = folders.get(id);
        if (!folder) return;
        const dir = folderPath(folder);
        folders.delete(id);
        if (trash) {
          try { await trash(dir); return; } catch { /* no trash on this system: delete */ }
        }
        await rm(dir, { recursive: true, force: true });
      });
    },

    // map === null clears the app data.
    saveAppData(id, map) {
      if (!isValidProjectId(id)) return Promise.reject(new Error('Invalid project id.'));
      return enqueue(id, async () => {
        await ensureScanned();
        const folder = folders.get(id);
        const file = folder ? join(folderPath(folder), APP_DATA_FILE) : orphanPath(id);
        if (map === null) {
          await rm(file, { force: true });
          return;
        }
        await mkdir(folder ? folderPath(folder) : orphanRoot, { recursive: true });
        await writeFileAtomic(file, JSON.stringify(sanitizeAppData(map)));
      });
    },

    folderOf(id) {
      const folder = folders.get(id);
      return folder ? folderPath(folder) : null;
    },

    flush,

    // Point the store at another root, optionally moving every project folder
    // there first. Returns how many folders were moved.
    async changeRoot(newRoot, { move = false } = {}) {
      await flush();
      const target = resolve(newRoot);
      await mkdir(target, { recursive: true });
      let moved = 0;
      if (move && target !== projectsRoot) {
        await ensureScanned();
        const taken = new Set((await readdir(target)).map((n) => n.toLowerCase()));
        for (const folder of folders.values()) {
          let name = folder;
          for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${folder} (${n})`;
          await moveDir(folderPath(folder), join(target, name));
          taken.add(name.toLowerCase());
          moved += 1;
        }
      }
      projectsRoot = target;
      scanned = false;
      await scan();
      return moved;
    },

    async count() {
      await ensureScanned();
      return folders.size;
    },
  };
}
