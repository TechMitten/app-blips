// In-memory log of the raw model traffic, for the PIN-gated debug panel.
//
// Nothing is recorded until the panel has been unlocked (recordRaw is a no-op
// while disabled), and nothing here is ever persisted: it stays out of project
// versions, localStorage, exports and the preview bridge. Reload = empty log.

const MAX_ENTRIES = 60;
// One long generation streams thousands of deltas; keep the raw lines but stop
// hoarding memory past this many characters per entry.
const MAX_STREAM_CHARS = 2 * 1024 * 1024;

let enabled = false;
let entries = [];
let nextId = 1;
const listeners = new Set();

const notify = () => {
  // A fresh array identity per change is what useSyncExternalStore keys on.
  entries = entries.slice();
  listeners.forEach((fn) => fn());
};

const NOOP_ENTRY = { update() {}, progress() {}, stream() {}, finish() {} };

// Streams arrive as hundreds of tiny deltas; re-render the panel at most a few
// times a second rather than once per line.
let flushTimer = null;
const notifySoon = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    notify();
  }, 250);
};

export const isRawLogEnabled = () => enabled;

export const setRawLogEnabled = (value) => {
  enabled = Boolean(value);
  if (!enabled) entries = [];
  notify();
};

export const subscribeRawLog = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getRawLogSnapshot = () => entries;

export const clearRawLog = () => {
  entries = [];
  notify();
};

// Starts an entry and returns a handle. While disabled the handle is inert, so
// call sites need no `if (enabled)` guards and pay nothing.
export const beginRawEntry = (init) => {
  if (!enabled) return NOOP_ENTRY;
  const entry = { id: nextId++, ts: Date.now(), rawStream: [], streamChars: 0, ...init };
  const startedAt = Date.now();
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  notify();
  return {
    // Merge fields (status, text, error, ...) into the entry.
    update(patch) {
      Object.assign(entry, patch);
      notify();
    },
    // Merge fields that grow while streaming (assembled text, reasoning), so
    // an in-flight call is readable before it finishes. Throttled like stream().
    progress(patch) {
      Object.assign(entry, patch);
      notifySoon();
    },
    // One raw SSE `data:` payload, exactly as received.
    stream(line) {
      if (entry.streamChars >= MAX_STREAM_CHARS) {
        entry.truncated = true;
        return;
      }
      entry.streamChars += line.length;
      entry.rawStream.push(line);
      notifySoon();
    },
    finish(patch) {
      Object.assign(entry, patch, { durationMs: Date.now() - startedAt });
      notify();
    },
  };
};

// One-shot entry (tool results, corrective re-prompts, retry notices).
export const recordRaw = (init) => {
  if (!enabled) return;
  beginRawEntry(init);
};
