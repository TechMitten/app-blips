// Run: node testing/testConnectors.js
// Connectors (lib/connectors.js) and the prompt text they add (prompts.js).
import assert from 'node:assert/strict';

// A tiny localStorage, installed before the module reads it.
const data = new Map();
globalThis.window = { localStorage: {
  get length() { return data.size; },
  getItem: (k) => (data.has(k) ? data.get(k) : null),
  setItem: (k, v) => { data.set(k, String(v)); },
} };

const {
  loadConnectors, saveConnectors, connectorStatus, getActiveConnectors, CONNECTORS_KEY, CONNECTOR_DEFINITIONS, CONNECTOR_IDS,
} = await import('../src/lib/connectors.js');
const { buildHtmlSystemPrompt, buildConnectorDirective, WEBSITE_HTML_SYSTEM_PROMPT } = await import('../src/lib/prompts.js');

const KEY = '3f2b8c1e-9a4d-4e6b-8c7a-1d2e3f4a5b6c';

// Nothing saved: everything off, nothing active.
assert.deepEqual(loadConnectors(), { web3forms: { enabled: false, key: '' } });
assert.equal(connectorStatus('web3forms'), 'off');
assert.deepEqual(getActiveConnectors(), []);

// On without a usable key is not active, so the AI isn't told to use a bad key.
saveConnectors({ web3forms: { enabled: true, key: '' } });
assert.equal(connectorStatus('web3forms'), 'needs-key');
saveConnectors({ web3forms: { enabled: true, key: 'not-a-key' } });
assert.equal(connectorStatus('web3forms'), 'needs-key');
assert.deepEqual(getActiveConnectors(), []);

// A valid key (surrounding spaces from a paste are ignored) is active.
saveConnectors({ web3forms: { enabled: true, key: `  ${KEY} ` } });
assert.equal(connectorStatus('web3forms'), 'connected');
assert.deepEqual(getActiveConnectors(), [{ id: 'web3forms', key: KEY }]);

// Switched off keeps the key but stops using it.
saveConnectors({ web3forms: { enabled: false, key: KEY } });
assert.equal(connectorStatus('web3forms'), 'off');
assert.deepEqual(getActiveConnectors(), []);
assert.equal(loadConnectors().web3forms.key, KEY);

// Corrupt or hostile storage never throws and reads as nothing connected.
for (const raw of ['{', 'null', '[]', '"x"', '{"web3forms":{"enabled":"yes","key":5}}']) {
  data.set(CONNECTORS_KEY, raw);
  assert.deepEqual(loadConnectors(), { web3forms: { enabled: false, key: '' } }, raw);
}

// Prompt: the directive carries the key, replaces the "no backend" rule, and
// is left out for games and when nothing is connected.
const active = [{ id: 'web3forms', key: KEY }];
const website = buildHtmlSystemPrompt('website', active);
assert.ok(website.startsWith(WEBSITE_HTML_SYSTEM_PROMPT));
assert.match(website, /CONNECTORS/);
assert.match(website, new RegExp(`name="access_key" value="${KEY}"`));
assert.match(website, /api\.web3forms\.com\/submit/);
assert.match(buildHtmlSystemPrompt('app', active), /access_key/);
assert.equal(buildHtmlSystemPrompt('game', active), buildHtmlSystemPrompt('game'));
assert.equal(buildHtmlSystemPrompt('website', []), buildHtmlSystemPrompt('website'));
assert.equal(buildConnectorDirective([{ id: 'unknown', key: 'x' }]), '');

// Every connector carries the text its "How it works" dialog shows.
for (const id of CONNECTOR_IDS) {
  const { about } = CONNECTOR_DEFINITIONS[id];
  assert.ok(typeof about?.what === 'string' && about.what, `${id}: about.what`);
  assert.ok(Array.isArray(about.steps) && about.steps.length > 0, `${id}: about.steps`);
  assert.ok(!about.notes || Array.isArray(about.notes), `${id}: about.notes`);
}

console.log('ok');
