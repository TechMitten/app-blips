// Run: node testing/testLicenses.js
// Settings → Licenses data (src/lib/thirdPartyLicenses.json) and the build
// check in scripts/licenses.js that keeps it in step with the bundles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LICENSES_FILE, syncLicenses } from '../scripts/licenses.js';

const data = JSON.parse(readFileSync(LICENSES_FILE, 'utf8'));

assert.match(data.appblips, /MIT License/);
assert.deepEqual(Object.keys(data.parts).sort(), ['app', 'desktop', 'server']);

// Every listed package has an entry, and every entry is listed somewhere.
const keys = new Set(data.packages.map(({ name, version }) => `${name}@${version}`));
const listed = new Set(Object.values(data.parts).flat());
assert.deepEqual([...listed].filter((key) => !keys.has(key)), []);
assert.deepEqual([...keys].filter((key) => !listed.has(key)), []);

for (const entry of [...data.packages, ...data.extras]) {
  assert.ok(entry.name && entry.license, JSON.stringify(entry).slice(0, 80));
  assert.equal(typeof entry.text, 'string', entry.name);
  // Rendered as links in the settings tab.
  assert.ok(entry.homepage === '' || /^https?:\/\//.test(entry.homepage), `${entry.name}: ${entry.homepage}`);
}
assert.ok(data.packages.some(({ name }) => name === 'react'));
assert.ok(data.extras.every(({ text }) => text.includes('Apache License')));

// The check passes for the packages the list holds and fails, naming the
// package, when the bundle has one the list doesn't.
const serverDirs = data.parts.server.map((key) => join('node_modules', key.slice(0, key.lastIndexOf('@'))));
syncLicenses('server', serverDirs);
assert.throws(() => syncLicenses('server', [...serverDirs, join('node_modules', 'acorn')]), /out of date[\s\S]*new: acorn@/);
assert.throws(() => syncLicenses('server', serverDirs.slice(1)), /gone: /);

console.log('ok');
