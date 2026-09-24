import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  beginRawEntry, clearRawLog, getRawLogSnapshot, recordRaw, setRawLogEnabled, subscribeRawLog,
} from '../src/lib/rawLog.js';

beforeEach(() => setRawLogEnabled(false));

test('records nothing while locked, and handles are inert', () => {
  const handle = beginRawEntry({ kind: 'request', label: 'x' });
  handle.stream('data');
  handle.finish({ text: 'hi' });
  recordRaw({ kind: 'note', label: 'n', text: 't' });
  assert.equal(getRawLogSnapshot().length, 0);
});

test('captures entries newest-first and merges updates', () => {
  setRawLogEnabled(true);
  const first = beginRawEntry({ kind: 'request', label: 'first', request: { a: 1 } });
  first.stream('{"x":1}');
  first.finish({ status: 200, text: 'done' });
  recordRaw({ kind: 'tool_result', label: 'apply_surgical_edits', result: { success: true } });

  const [newest, oldest] = getRawLogSnapshot();
  assert.equal(newest.label, 'apply_surgical_edits');
  assert.equal(oldest.label, 'first');
  assert.deepEqual(oldest.rawStream, ['{"x":1}']);
  assert.equal(oldest.text, 'done');
  assert.equal(typeof oldest.durationMs, 'number');
});

test('locking clears the buffer and notifies subscribers with a new snapshot', () => {
  setRawLogEnabled(true);
  recordRaw({ kind: 'note', label: 'n', text: 't' });
  const before = getRawLogSnapshot();
  let calls = 0;
  const unsubscribe = subscribeRawLog(() => { calls += 1; });
  clearRawLog();
  assert.ok(calls >= 1);
  assert.notEqual(getRawLogSnapshot(), before);
  assert.equal(getRawLogSnapshot().length, 0);
  setRawLogEnabled(false);
  unsubscribe();
});

test('ring buffer caps entries and stream size is bounded', () => {
  setRawLogEnabled(true);
  for (let i = 0; i < 80; i += 1) recordRaw({ kind: 'note', label: `n${i}` });
  assert.equal(getRawLogSnapshot().length, 60);
  assert.equal(getRawLogSnapshot()[0].label, 'n79');

  const handle = beginRawEntry({ kind: 'request', label: 'big' });
  const chunk = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < 5; i += 1) handle.stream(chunk);
  handle.finish({});
  const big = getRawLogSnapshot()[0];
  assert.equal(big.rawStream.length, 2);
  assert.equal(big.truncated, true);
});
