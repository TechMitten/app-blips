// Shared by the codebase tests: reads a fixture project folder and zips it
// (optionally under a top folder, the way "Compress folder" does).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';

export const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;

export function readFixture(name) {
  const root = join(FIXTURES, name);
  const out = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(root, full).split(sep).join('/')] = new Uint8Array(readFileSync(full));
    }
  };
  walk(root);
  return out;
}

export function zipFixture(name, { top = '', extra = {} } = {}) {
  const entries = {};
  for (const [path, bytes] of Object.entries({ ...readFixture(name), ...extra })) {
    entries[`${top}${path}`] = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  }
  return zipSync(entries);
}
