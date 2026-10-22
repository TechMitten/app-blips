// Run: node testing/testPreviewAnalyticsOptOut.js
// The preview's storage shim sets Umami's and Plausible's "exclude my visits"
// flags, so previews don't count as visits, without saving them as app data.
import assert from 'node:assert/strict';
import { PREVIEW_BRIDGE_SCRIPT as src } from '../src/previewBridge.js';
const body = src.slice(src.indexOf('function memStorage('), src.indexOf('function shimStorage('));
const posts = [];
const memStorage = new Function('post', body + 'return memStorage;')((t, p) => posts.push([t, p]));
const ls = memStorage({ a: '1' }, true);
assert.equal(ls.getItem('umami.disabled'), '1');
assert.equal(ls.plausible_ignore, 'true');
assert.equal(ls.getItem('a'), '1');
assert.equal(ls.length, 1);
ls.clear(); ls.removeItem('umami.disabled');
assert.equal(ls.getItem('umami.disabled'), '1');
assert.equal(ls.plausible_ignore, 'true');
assert.equal(ls.length, 0);
assert.ok(!posts.some(([t, p]) => t === 'storage_set' && /umami|plausible/.test(JSON.stringify(p))));
const ss = memStorage(null, false);
assert.equal(ss.getItem('umami.disabled'), null);
assert.equal(ss.plausible_ignore, undefined);
console.log('ok');
