// Run: node testing/testSetupHints.js
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// llm.js uses extensionless imports, so it loads through Vite like testTruncation.js.
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const { findSetupHints } = await server.ssrLoadModule('/src/lib/llm.js');
await server.close();

// Placeholders the user must fill in are found, even far down a long new file
// (the clipped change list would miss them).
const filler = '<p>filler</p>\n'.repeat(500);
const built = {
  'index.html': `<!DOCTYPE html>\n${filler}<script>\nconst API_KEY = 'YOUR_API_KEY';\nfetch(url + API_KEY);\n</script>`,
};
assert.deepEqual(findSetupHints({}, built), ["const API_KEY = 'YOUR_API_KEY';"]);

for (const line of [
  'const token = "your-access-token-here";',
  'apiKey: "REPLACE_WITH_YOUR_KEY",',
  'const id = "ENTER_CLIENT_ID";',
  'const key = import.meta.env.VITE_MAPS_KEY;',
  'const secret = process.env.STRIPE_SECRET;',
]) {
  assert.equal(findSetupHints({}, { 'a.js': line }).length, 1, line);
}

// Ordinary code isn't flagged.
for (const line of [
  'const key = items.map((item) => item.id);',
  "localStorage.setItem('your-scores', data);",
  "if (process.env.NODE_ENV === 'production') {}",
  'Add your email below to subscribe.',
]) {
  assert.deepEqual(findSetupHints({}, { 'a.js': line }), [], line);
}

// Only lines new in this turn count: a placeholder from an earlier build
// doesn't bring the setup steps back on every later edit.
const edited = { 'index.html': built['index.html'].replace('<p>filler</p>', '<h1>Hi</h1>') };
assert.deepEqual(findSetupHints(built, edited), []);
assert.deepEqual(findSetupHints(built, built), []);

assert.equal(findSetupHints({}, { 'a.js': Array(20).fill("k = 'YOUR_API_KEY';").map((l, i) => l + i).join('\n') }).length, 8);

console.log('testSetupHints: ok');
