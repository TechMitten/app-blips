// Project backup export/import (src/lib/projectBackup.js).
// Run: node --test testing/testProjectBackup.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBackup, backupFileName, parseBackup, mergeBackup, validateBackupRow } from '../src/lib/projectBackup.js';

const row = (id, updatedAt, files = { 'index.html': '<p>hi</p>' }) => ({
  id, name: `App ${id}`, updatedAt, data: { versions: [{ files }], currentVersionIndex: 0 },
});

test('round trip keeps rows and non-empty app data', () => {
  const rows = [row('1', '2026-01-01T00:00:00.000Z'), row('2', '2026-01-02T00:00:00.000Z')];
  const data = { 1: { score: '9' }, 2: {} };
  const backup = buildBackup(rows, (id) => data[id], new Date('2026-10-02T10:00:00Z'));
  assert.equal(backup.exportedAt, '2026-10-02T10:00:00.000Z');
  const { projects, skipped } = parseBackup(JSON.stringify(backup));
  assert.equal(skipped, 0);
  assert.deepEqual(projects.map((p) => p.row), rows);
  assert.deepEqual(projects.map((p) => p.appData), [{ score: '9' }, null]);
  assert.equal(backupFileName(new Date('2026-10-02T10:00:00Z')), 'appblips-backup-2026-10-02.json');
});

test('non-backups are rejected with a readable message', () => {
  assert.throws(() => parseBackup('not json'), /not valid JSON/);
  assert.throws(() => parseBackup('{"projects":[]}'), /not an AppBlips backup/);
  assert.throws(() => parseBackup('{"format":"appblips-backup","version":2,"projects":[]}'), /newer version/);
});

test('malformed entries are skipped, not half-applied', () => {
  const good = row('ok', '2026-01-01T00:00:00.000Z');
  const text = JSON.stringify({
    format: 'appblips-backup',
    version: 1,
    projects: [
      { row: good, appData: { a: '1', __proto__: 'x', n: 5 } },
      { row: { ...good, id: '../escape' } },
      { row: row('bad-page', null, { '../x.html': 'nope' }) },
      { row: row('bad-html', null, { 'index.html': 42 }) },
      { row: { ...good, id: 'bad-date', updatedAt: 'whenever' } },
      'junk',
    ],
  });
  const { projects, skipped } = parseBackup(text);
  assert.deepEqual(projects.map((p) => p.row.id), ['ok']);
  assert.deepEqual(projects[0].appData, { a: '1' });
  assert.equal(skipped, 5);
});

test('merge adds new apps and replaces only with newer copies', () => {
  const existing = [row('1', '2026-03-01T00:00:00.000Z'), row('2', '2026-03-01T00:00:00.000Z')];
  const incoming = [
    { row: row('1', '2026-02-01T00:00:00.000Z'), appData: { old: '1' } }, // older: kept as is
    { row: row('2', '2026-04-01T00:00:00.000Z'), appData: { fresh: '1' } }, // newer: replaced
    { row: row('3', '2026-01-01T00:00:00.000Z'), appData: null }, // new
  ];
  const result = mergeBackup(existing, incoming);
  assert.deepEqual([result.added, result.updated, result.unchanged], [1, 1, 1]);
  assert.deepEqual(result.rows.map((r) => [r.id, r.updatedAt]), [
    ['1', '2026-03-01T00:00:00.000Z'],
    ['2', '2026-04-01T00:00:00.000Z'],
    ['3', '2026-01-01T00:00:00.000Z'],
  ]);
  assert.deepEqual(result.appData, [{ id: '2', map: { fresh: '1' } }]);
  assert.equal(existing[1].updatedAt, '2026-03-01T00:00:00.000Z'); // input not mutated
});

test('imported codebases are left out of backups and refused on import', () => {
  // Their files live in a blob store a JSON backup can't carry.
  const site = { id: 's1', name: 'Site', updatedAt: new Date().toISOString(), data: { studioMode: 'codebase', versions: [{ tree: { 'src/App.tsx': 'a'.repeat(64) } }] } };
  const app = { id: 'a1', name: 'App', updatedAt: new Date().toISOString(), data: { versions: [{ files: { 'index.html': '<h1>x</h1>' } }] } };
  const backup = buildBackup([site, app], () => null);
  assert.deepEqual(backup.projects.map((p) => p.row.id), ['a1']);
  assert.equal(validateBackupRow(site), false);
  assert.equal(validateBackupRow(app), true);
});
