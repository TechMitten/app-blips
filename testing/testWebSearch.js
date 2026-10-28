// The AI's web_search tool (src/lib/webSearch.js): argument handling, the
// per-request budget, untrusted-content labelling, and what a rejected key
// does to the connector. Searches are stubbed. Run: node testing/testWebSearch.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

// A tiny localStorage, installed before connectors.js reads it.
const data = new Map();
globalThis.window = { localStorage: {
  get length() { return data.size; },
  getItem: (k) => (data.has(k) ? data.get(k) : null),
  setItem: (k, v) => { data.set(k, String(v)); },
} };

const { saveConnectors, connectorStatus } = await import('../src/lib/connectors.js');
const {
  WEB_SEARCH_TOOL, UNTRUSTED_NOTE, createWebSearchBudget, executeWebSearch, formatWebResearch, isWebSearchCall, isWebSearchEnabled,
} = await import('../src/lib/webSearch.js');

const toolCall = (args) => ({ id: 'c1', type: 'function', function: { name: 'web_search', arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const RESULT = { title: 'Blue Door Café', url: 'https://bluedoor.example/', content: 'Open 8am to 4pm.' };

test('the tool is a strict function tool with every property required', () => {
  const { name, parameters, strict } = WEB_SEARCH_TOOL.function;
  assert.equal(name, 'web_search');
  assert.equal(strict, true);
  assert.deepEqual(parameters.required.sort(), Object.keys(parameters.properties).sort());
  assert.equal(isWebSearchCall(toolCall({})), true);
  assert.equal(isWebSearchCall({ function: { name: 'view_code' } }), false);
});

test('enabled only while the connector is on with a saved key', () => {
  saveConnectors({ tavily: { enabled: true, key: '', keyHint: '' } });
  assert.equal(isWebSearchEnabled(), false);
  saveConnectors({ tavily: { enabled: true, key: '', keyHint: '0e1f' } });
  assert.equal(isWebSearchEnabled(), true);
  saveConnectors({ tavily: { enabled: false, key: '', keyHint: '0e1f' } });
  assert.equal(isWebSearchEnabled(), false);
});

test('a search passes clean arguments and labels the results as untrusted', async () => {
  const calls = [];
  const search = async (args) => { calls.push(args); return { results: [RESULT] }; };
  const result = await executeWebSearch(toolCall({ query: '  blue door café ', topic: 'news', time_range: 'week' }), createWebSearchBudget(), { search });
  assert.deepEqual(calls[0], { query: 'blue door café', topic: 'news', time_range: 'week' });
  assert.equal(result.success, true);
  assert.equal(result.note, UNTRUSTED_NOTE);
  assert.deepEqual(result.results, [RESULT]);

  await executeWebSearch(toolCall({ query: 'x', topic: 'finance', time_range: 'decade' }), createWebSearchBudget(), { search });
  assert.deepEqual(calls[1], { query: 'x', topic: 'general', time_range: null });
});

test('bad arguments are reported back without searching', async () => {
  let searched = 0;
  const search = async () => { searched++; return { results: [] }; };
  assert.equal((await executeWebSearch(toolCall('{"query": "cut off'), createWebSearchBudget(), { search })).success, false);
  assert.equal((await executeWebSearch(toolCall({ query: '  ' }), createWebSearchBudget(), { search })).success, false);
  assert.equal(searched, 0);
});

test('the budget caps searches per request', async () => {
  let searched = 0;
  const search = async () => { searched++; return { results: [] }; };
  const budget = createWebSearchBudget(2);
  for (let i = 0; i < 4; i++) await executeWebSearch(toolCall({ query: `q${i}` }), budget, { search });
  assert.equal(searched, 2);
  const over = await executeWebSearch(toolCall({ query: 'more' }), budget, { search });
  assert.equal(over.success, false);
  assert.match(over.error, /limit/);
});

test('a rejected key marks the connector as needing a key and stops searching', async () => {
  saveConnectors({ tavily: { enabled: true, key: '', keyHint: '0e1f' } });
  const budget = createWebSearchBudget();
  const result = await executeWebSearch(toolCall({ query: 'x' }), budget, { search: async () => ({ error: 'Tavily didn’t accept your API key.', signedOut: true }) });
  assert.equal(result.success, false);
  assert.match(result.error, /Continue without searching/);
  assert.equal(budget.left, 0);
  assert.equal(connectorStatus('tavily'), 'needs-key');

  // Other errors (busy, out of credits) leave the key alone.
  saveConnectors({ tavily: { enabled: true, key: '', keyHint: '0e1f' } });
  await executeWebSearch(toolCall({ query: 'x' }), createWebSearchBudget(), { search: async () => ({ error: 'Tavily is busy.' }) });
  assert.equal(connectorStatus('tavily'), 'connected');
});

test('research findings become one capped, labelled block', () => {
  assert.equal(formatWebResearch([]), '');
  assert.equal(formatWebResearch([{ query: 'x', results: [] }]), '');
  const block = formatWebResearch([{ query: 'blue door café', results: [{ ...RESULT, published_date: '2026-10-01' }] }]);
  assert.match(block, /^WEB RESEARCH/);
  assert.ok(block.includes(UNTRUSTED_NOTE));
  assert.match(block, /Search: blue door café\n- Blue Door Café \(https:\/\/bluedoor\.example\/\) \[2026-10-01\]: Open 8am to 4pm\./);
  const huge = formatWebResearch([{ query: 'x', results: Array.from({ length: 50 }, (_, i) => ({ title: `t${i}`, url: `https://e.example/${i}`, content: 'z'.repeat(1200) })) }]);
  assert.ok(huge.length < 6600);
});
