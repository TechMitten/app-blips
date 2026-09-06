import assert from 'node:assert/strict';
import { injectPreviewBridge } from '../src/previewBridge.js';
import {
  applyStorageChange,
  getPreviewStorageKey,
} from '../src/lib/previewStorage.js';

console.log('Testing previewStorage logic...');

// 1. Key generation
assert.equal(getPreviewStorageKey('proj-123'), 'orion-preview-storage:proj-123');
assert.equal(getPreviewStorageKey(null), 'orion-preview-storage:draft');
assert.equal(getPreviewStorageKey(''), 'orion-preview-storage:draft');

// 2. applyStorageChange
const store = {};

// storage_set
const setRes1 = applyStorageChange(store, 'storage_set', { key: 'todos', value: '["task1"]' });
assert.equal(setRes1, true);
assert.equal(store.todos, '["task1"]');

// prototype pollution resistance
const pollRes = applyStorageChange(store, 'storage_set', { key: '__proto__', value: 'bad' });
assert.equal(pollRes, false);
assert.equal(Object.prototype.bad, undefined);

const pollRes2 = applyStorageChange(store, 'storage_set', { key: 'constructor', value: 'bad' });
assert.equal(pollRes2, false);

// storage_remove
const remRes = applyStorageChange(store, 'storage_remove', { key: 'todos' });
assert.equal(remRes, true);
assert.equal('todos' in store, false);

// storage_clear
store.a = '1';
store.b = '2';
const clearRes = applyStorageChange(store, 'storage_clear', {});
assert.equal(clearRes, true);
assert.equal(Object.keys(store).length, 0);

// 3. injectPreviewBridge with initial storage & XSS prevention
const sampleHtml = '<!DOCTYPE html><html><head><title>App</title></head><body><h1>Hello</h1></body></html>';
const sampleStorage = {
  theme: 'dark',
  greeting: 'Hello </script><script>alert(1)</script>',
};

const { srcDoc, token } = injectPreviewBridge(sampleHtml, { initialStorage: sampleStorage });
assert.ok(token);
assert.ok(srcDoc.includes('<script>'));
// Ensure that the injected HTML script tag is NOT broken by the </script> inside greeting
assert.ok(!srcDoc.includes('alert(1)</script>'));
assert.ok(srcDoc.includes('\\u003c/script>'));

// 4. In-frame execution test using node:vm
import vm from 'node:vm';

const scriptMatch = /<script>([\s\S]*?)<\/script>/i.exec(srcDoc);
assert.ok(scriptMatch, 'Bridge script must be present in srcDoc');
const bridgeJs = scriptMatch[1];

const postedMessages = [];
const fakeParent = {
  postMessage: (msg, targetOrigin) => {
    postedMessages.push({ msg, targetOrigin });
  },
};

const sandbox = {
  window: {},
  Window: function Window() {},
  document: {
    cookie: '',
    readyState: 'complete',
    addEventListener: () => {},
    removeEventListener: () => {},
    head: { appendChild: () => {} },
    documentElement: { style: {} },
    createElement: () => ({ setAttribute: () => {}, style: {} }),
  },
  Document: function Document() {},
  parent: fakeParent,
  console: console,
  addEventListener: () => {},
  removeEventListener: () => {},
};
sandbox.window = sandbox;
sandbox.Window.prototype = {};
sandbox.Document.prototype = {};

// Make native localStorage access throw a SecurityError, simulating an opaque origin
Object.defineProperty(sandbox.window, 'localStorage', {
  get: () => {
    throw new Error("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.");
  },
  configurable: true,
});
Object.defineProperty(sandbox.window, 'sessionStorage', {
  get: () => {
    throw new Error("Failed to read the 'sessionStorage' property from 'Window': Access is denied for this document.");
  },
  configurable: true,
});

vm.createContext(sandbox);
vm.runInContext(bridgeJs, sandbox);

// Verify that localStorage was shimmed and populated with initialStorage
assert.equal(sandbox.window.localStorage.getItem('theme'), 'dark');
assert.equal(sandbox.window.localStorage.length, 2);

// Test setItem
sandbox.window.localStorage.setItem('counter', '42');
assert.equal(sandbox.window.localStorage.getItem('counter'), '42');
const setMsg = postedMessages.find((m) => m.msg.type === 'storage_set');
assert.ok(setMsg);
assert.equal(setMsg.msg.payload.key, 'counter');
assert.equal(setMsg.msg.payload.value, '42');
assert.equal(setMsg.msg.token, token);

// Test removeItem
sandbox.window.localStorage.removeItem('counter');
assert.equal(sandbox.window.localStorage.getItem('counter'), null);
const remMsg = postedMessages.find((m) => m.msg.type === 'storage_remove');
assert.ok(remMsg);
assert.equal(remMsg.msg.payload.key, 'counter');

// Test clear
sandbox.window.localStorage.clear();
assert.equal(sandbox.window.localStorage.length, 0);
const clearMsg = postedMessages.find((m) => m.msg.type === 'storage_clear');
assert.ok(clearMsg);

console.log('All preview storage tests passed successfully!');
