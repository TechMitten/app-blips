// Project backup files: "Export all projects" / "Import projects…" in
// Settings → Data. Moves self-hosted projects between browsers and into the
// desktop app (whose storage the browser cannot see), and doubles as a manual
// backup. Pure helpers, no React or Firebase, so testing/testProjectBackup.js
// can load them in node.
//
// File shape: { format: 'appblips-backup', version: 1, exportedAt,
//               projects: [{ row, appData }] }
// where `row` is exactly a localStorage['orion-projects'] row and `appData`
// the generated app's storage map (lib/previewStorage.js), or null.
//
// An imported file is treated as untrusted input: anything malformed is
// skipped (and counted), never half-applied.
import { validatePageName } from './pages.js';

export const BACKUP_FORMAT = 'appblips-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_PROJECTS = 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_NAME_LENGTH = 200;
const MAX_APP_DATA_CHARS = 2 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function buildBackup(rows, appDataFor, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    projects: rows.map((row) => {
      const appData = appDataFor(row.id);
      return { row, appData: appData && Object.keys(appData).length ? appData : null };
    }),
  };
}

export const backupFileName = (now = new Date()) => `appblips-backup-${now.toISOString().slice(0, 10)}.json`;

const validVersion = (version) => {
  if (!isPlainObject(version)) return false;
  if (version.code != null && typeof version.code !== 'string') return false;
  if (version.files != null) {
    if (!isPlainObject(version.files)) return false;
    for (const [name, html] of Object.entries(version.files)) {
      if (!validatePageName(name) || typeof html !== 'string') return false;
    }
  }
  return true;
};

export function validateBackupRow(row) {
  if (!isPlainObject(row)) return false;
  if (typeof row.id !== 'string' || !ID_RE.test(row.id)) return false;
  if (typeof row.name !== 'string' || row.name.length > MAX_NAME_LENGTH) return false;
  if (row.updatedAt != null && (typeof row.updatedAt !== 'string' || Number.isNaN(Date.parse(row.updatedAt)))) return false;
  if (!isPlainObject(row.data)) return false;
  const { versions } = row.data;
  if (versions != null && (!Array.isArray(versions) || !versions.every(validVersion))) return false;
  return true;
}

const cleanAppData = (map) => {
  if (!isPlainObject(map)) return null;
  const clean = {};
  for (const [key, value] of Object.entries(map)) {
    if (FORBIDDEN_KEYS.has(key) || typeof value !== 'string') continue;
    clean[key] = value;
  }
  if (!Object.keys(clean).length || JSON.stringify(clean).length > MAX_APP_DATA_CHARS) return null;
  return clean;
};

// Returns { projects: [{ row, appData }], skipped } or throws with a
// user-facing message when the file is not a backup at all.
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isPlainObject(parsed) || parsed.format !== BACKUP_FORMAT) {
    throw new Error('That file is not an AppBlips backup.');
  }
  if (parsed.version !== BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of AppBlips.');
  }
  if (!Array.isArray(parsed.projects)) throw new Error('The backup has no project list.');

  const projects = [];
  let skipped = 0;
  for (const entry of parsed.projects.slice(0, MAX_BACKUP_PROJECTS)) {
    if (!isPlainObject(entry) || !validateBackupRow(entry.row)) {
      skipped += 1;
      continue;
    }
    projects.push({ row: entry.row, appData: cleanAppData(entry.appData) });
  }
  skipped += Math.max(0, parsed.projects.length - MAX_BACKUP_PROJECTS);
  return { projects, skipped };
}

const time = (row) => Date.parse(row?.updatedAt || '') || 0;

// Merges imported projects into the existing rows. A project whose id already
// exists is replaced only when the imported copy is newer.
// Returns { rows, added, updated, unchanged, appData: [{ id, map }] }.
export function mergeBackup(existingRows, projects) {
  const rows = existingRows.slice();
  const index = new Map(rows.map((row, i) => [row.id, i]));
  const appData = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const { row, appData: map } of projects) {
    const at = index.get(row.id);
    if (at === undefined) {
      index.set(row.id, rows.length);
      rows.push(row);
      added += 1;
    } else if (time(row) > time(rows[at])) {
      rows[at] = row;
      updated += 1;
    } else {
      unchanged += 1;
      continue;
    }
    if (map) appData.push({ id: row.id, map });
  }
  return { rows, added, updated, unchanged, appData };
}
