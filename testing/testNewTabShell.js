// "Open in new tab" shell (src/lib/newTabShell.js): the generated app runs in
// a sandboxed iframe and only reaches the trusted shell over postMessage.
// Runs the shell's inline script in a vm with a fake document/iframe.
// Run: node --test testing/testNewTabShell.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { buildNewTabShell, NEW_TAB_SANDBOX } from '../src/lib/newTabShell.js';
import { BRIDGE_CHANNEL, BRIDGE_PROTOCOL_VERSION } from '../src/previewBridge.js';

const CLOSE = '</' + 'script>';
const FILES = {
  'index.html': '<html><head><title>Home</title></head><body><a href="about.html#team">About</a><script>var s = "' + CLOSE + '";' + CLOSE + '</body></html>',
  'about.html': '<html><head><title>About us</title></head><body><h1 id="team">Team</h1></body></html>',
};

const extract = (html, open) => html.split(open)[1].split(CLOSE)[0];

// Boots the shell script against fakes. Returns hooks to drive it.
function boot(options, { fetchImpl } = {}) {
  const html = buildNewTabShell({ files: FILES, title: 'My app', ...options });
  const data = JSON.parse(extract(html, '<script type="application/json" id="appblips-shell-data">'));
  const posted = [];
  const loads = [];
  const contentWindow = { postMessage: (msg, target) => posted.push({ msg, target }) };
  const frame = {
    contentWindow,
    set srcdoc(value) { loads.push(value); },
  };
  const listeners = [];
  const fetches = [];
  const win = {
    opener: { secret: true },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
  };
  const doc = {
    title: '',
    getElementById: (id) => (id === 'appblips-shell-data' ? { textContent: extract(html, '<script type="application/json" id="appblips-shell-data">') } : id === 'appblips-app' ? frame : null),
  };
  const context = vm.createContext({
    window: win,
    document: doc,
    JSON, Object, Array, String, Promise, TextDecoder, Uint8Array,
    fetch: (url, init) => { fetches.push({ url, init }); return fetchImpl(url, init); },
  });
  vm.runInContext(extract(html, '<script>'), context);
  const tokenOf = (page) => data.pages[page].token;
  const message = (type, payload, { token = tokenOf('index.html'), source = contentWindow, channel = BRIDGE_CHANNEL } = {}) => {
    listeners.forEach((fn) => fn({ source, data: { __orion: channel, v: BRIDGE_PROTOCOL_VERSION, token, type, payload } }));
  };
  return { html, data, posted, loads, fetches, win, doc, message, tokenOf };
}

const storageSeedOf = (srcdoc) => JSON.parse(/var INITIAL_STORAGE = (\{.*?\});/.exec(srcdoc)[1]);
const flush = () => new Promise((r) => setTimeout(r, 10));

test('the app is sandboxed without same-origin or top navigation', () => {
  const { html } = boot({});
  assert.match(html, new RegExp(`<iframe id="appblips-app"[^>]* sandbox="${NEW_TAB_SANDBOX}"`));
  assert.ok(!NEW_TAB_SANDBOX.includes('allow-same-origin'));
  assert.ok(!NEW_TAB_SANDBOX.includes('allow-top-navigation'));
  // Page HTML (even a stray closing script tag) cannot end the shell's scripts early.
  assert.equal(html.split(CLOSE).length - 1, 2);
});

test('loads the landing page with the bridge and the storage seed, and drops the opener', () => {
  const { loads, win, doc } = boot({ initialStorage: { score: '7', evil: CLOSE } });
  assert.equal(loads.length, 1);
  assert.ok(loads[0].includes('<a href="about.html#team">'));
  assert.ok(loads[0].includes(BRIDGE_CHANNEL));
  assert.deepEqual(storageSeedOf(loads[0]), { score: '7', evil: CLOSE });
  assert.ok(!/var INITIAL_STORAGE = [^;]*<\//.test(loads[0]), 'storage seed is escaped');
  assert.equal(win.opener, null);
  assert.equal(doc.title, 'Home');
});

test('storage changes carry over to the next page; links resolve to pages and hashes', () => {
  const { loads, posted, message, tokenOf, doc } = boot({ initialStorage: { a: '1' } });
  message('storage_set', { key: 'b', value: '2' });
  message('storage_set', { key: '__proto__', value: 'x' });
  message('storage_remove', { key: 'a' });
  message('navigate-page', { href: 'about.html#team' });
  assert.equal(loads.length, 2);
  assert.ok(loads[1].includes('<h1 id="team">'));
  assert.deepEqual(storageSeedOf(loads[1]), { b: '2' });
  assert.equal(doc.title, 'About us');
  message('ready', {}, { token: tokenOf('about.html') });
  assert.deepEqual(posted.at(-1).msg.type, 'scroll-to-hash');
  assert.deepEqual({ ...posted.at(-1).msg.payload }, { hash: 'team' });
  message('storage_clear', {}, { token: tokenOf('about.html') });
  message('navigate-page', { href: '/' }, { token: tokenOf('about.html') });
  assert.deepEqual(storageSeedOf(loads[2]), {});
});

test('ignores other windows, stale tokens, other channels and non-page links', () => {
  const { loads, message } = boot({});
  message('navigate-page', { href: 'about.html' }, { source: {} });
  message('navigate-page', { href: 'about.html' }, { token: 'not-a-token' });
  message('navigate-page', { href: 'about.html' }, { channel: 'other' });
  message('navigate-page', { href: 'https://example.com/about.html' });
  message('navigate-page', { href: 'missing.html' });
  message('navigate-page', { href: '../about.html' });
  assert.equal(loads.length, 1);
});

test('AI is refused when the switch was off', async () => {
  const { posted, message, fetches } = boot({ aiMode: 'off' }, { fetchImpl: () => assert.fail('no fetch') });
  message('ai-chat-request', { requestId: 'r1', messages: [{ role: 'user', content: 'hi' }] });
  await flush();
  assert.equal(fetches.length, 0);
  assert.equal(posted.at(-1).msg.type, 'ai-chat-error');
  assert.equal(posted.at(-1).msg.payload.code, 'unauthorized');
});

test('relay mode forwards AI to the relay and streams the reply back', async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n';
  const { posted, message, fetches, loads } = boot(
    { aiMode: 'relay', relayUrl: 'http://localhost:5175/api/app-ai/chat' },
    { fetchImpl: async () => new Response(sse, { status: 200 }) },
  );
  assert.ok(/var AI_ENABLED = true;/.test(loads[0]));
  message('ai-chat-request', { requestId: 'r1', messages: [{ role: 'tool', content: 5 }, { role: 'user', content: 'hi' }], temperature: 0.3, maxTokens: 50 });
  await flush();
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].url, 'http://localhost:5175/api/app-ai/chat');
  assert.deepEqual(JSON.parse(fetches[0].init.body), {
    messages: [{ role: 'user', content: '5' }, { role: 'user', content: 'hi' }],
    stream: true,
    temperature: 0.3,
    max_tokens: 50,
  });
  const ai = posted.filter((p) => p.msg.type.startsWith('ai-chat'));
  assert.deepEqual(ai.map((p) => [p.msg.type, p.msg.payload.text]), [
    ['ai-chat-chunk', 'Hel'], ['ai-chat-chunk', 'lo'], ['ai-chat-response', 'Hello'],
  ]);
});

test('relay errors come back as bridge error codes', async () => {
  const { posted, message } = boot(
    { aiMode: 'relay', relayUrl: 'http://x/api/app-ai/chat' },
    { fetchImpl: async () => new Response('{}', { status: 429 }) },
  );
  message('ai-chat-request', { requestId: 'r1', messages: [] });
  await flush();
  assert.equal(posted.at(-1).msg.type, 'ai-chat-error');
  assert.equal(posted.at(-1).msg.payload.code, 'rate_limited');
});

test('BYOK pages get the BYOK bridge and no shell AI', () => {
  const { loads, data } = boot({ aiMode: 'byok', relayUrl: 'http://ignored' });
  assert.ok(/var AI_ENABLED = false;/.test(loads[0]));
  assert.ok(loads[0].includes('"byok"'));
  assert.equal(data.relayUrl, '');
});
