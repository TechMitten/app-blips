// Usage ids (src/lib/usage.js): every request of one action shares an id,
// a new action gets a new one, and automatic repairs are marked.
import assert from 'node:assert/strict';
import { markAutomaticRepair, usageFields } from '../src/lib/usage.js';

const build = new AbortController().signal;
const first = usageFields(build);
assert.match(first.usage_id, /^[A-Za-z0-9_-]{8,64}$/, 'the id passes the server check (buildWindow.js usageIdOf)');
assert.deepEqual(usageFields(build), first, 'later requests of the same action send the same id');
assert.equal(first.automatic_repair, undefined);

const next = usageFields(new AbortController().signal);
assert.notEqual(next.usage_id, first.usage_id, 'a new action gets a new id');

const repair = new AbortController().signal;
markAutomaticRepair(repair);
const repairFields = usageFields(repair);
assert.equal(repairFields.automatic_repair, true);
assert.deepEqual(usageFields(repair), repairFields);

assert.deepEqual(usageFields(null), {}, 'no signal: no id, so the request counts on its own');
markAutomaticRepair(null);

console.log('Usage id checks passed.');
