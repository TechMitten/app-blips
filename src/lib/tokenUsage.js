// Token counts reported by the AI provider, summed per chat turn so the
// transcript can show what a build, Ask or review cost. One turn makes many
// AI requests (routing, refinement turns, repairs, the closing reply), all
// through requestModelText, which tracks each one here (trackRequest).
//
// Providers only report counts when a request finishes, so while one is in
// flight its share is estimated (request size when sent, streamed text as it
// arrives) and swapped for the reported counts at the end. The live counter
// shows the running sum, marked as approximate while any estimate is in it.

// The OpenAI-shaped `usage` every provider path returns (anthropic.js
// converts Claude's counts to it), as { input, output }, or null when the
// provider sent none. Reasoning tokens are already part of completion_tokens.
export const normalizeUsage = (usage) => {
  const input = Number(usage?.prompt_tokens);
  const output = Number(usage?.completion_tokens);
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
  return {
    input: Number.isFinite(input) && input > 0 ? Math.round(input) : 0,
    output: Number.isFinite(output) && output > 0 ? Math.round(output) : 0,
  };
};

// Roughly 4 characters per token for English text and code. Only used until
// the provider's own counts arrive.
const CHARS_PER_TOKEN = 4;
// An attached image is sent as a data URL; its base64 length says nothing
// about the tokens it costs. Counted as a flat, typical amount instead.
const IMAGE_TOKEN_ESTIMATE = 1000;

export const estimateRequestTokens = (body) => {
  let images = 0;
  const json = JSON.stringify(body, (key, value) => {
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      images += 1;
      return '';
    }
    return value;
  }) || '';
  return Math.ceil(json.length / CHARS_PER_TOKEN) + images * IMAGE_TOKEN_ESTIMATE;
};

const activeMeters = new Set();
const liveRequests = new Set();
// Estimates of finished requests the provider sent no counts for (local
// servers), kept per meter so the live counter doesn't fall back when such a
// request ends. Never part of a meter's saved totals.
const unreported = new WeakMap();
const requestEstimate = (request) => ({ input: request.input, output: Math.ceil(request.outputChars / CHARS_PER_TOKEN) });
// The meter the transcript's live counter follows: the latest one started.
let liveMeter = null;
let liveSnapshot = null;
const liveListeners = new Set();
let notifyTimer = null;

const takeSnapshot = () => {
  if (!liveMeter) return null;
  const guessed = unreported.get(liveMeter);
  let input = liveMeter.input + (guessed?.input || 0);
  let output = liveMeter.output + (guessed?.output || 0);
  let estimating = Boolean(guessed);
  for (const request of liveRequests) {
    if (!request.meters.has(liveMeter)) continue;
    estimating = true;
    const estimate = requestEstimate(request);
    input += estimate.input;
    output += estimate.output;
  }
  return { input, output, calls: liveMeter.calls, reported: liveMeter.reported, estimating };
};

// Streams can deliver hundreds of chunks a second; the counter only needs a
// few updates a second.
const notifyLive = ({ now = false } = {}) => {
  const flush = () => {
    notifyTimer = null;
    liveSnapshot = takeSnapshot();
    for (const listener of liveListeners) listener();
  };
  if (now) {
    clearTimeout(notifyTimer);
    flush();
  } else if (!notifyTimer) {
    notifyTimer = setTimeout(flush, 150);
  }
};

// For useSyncExternalStore: the running totals of the current turn, or null
// when none is in progress.
export const subscribeLiveUsage = (listener) => {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
};
export const getLiveUsage = () => liveSnapshot;

// Counts every request recorded until stop(). stop() can be called more than
// once (a build's version and its cleanup both call it) and returns the same
// totals each time.
export const startUsageMeter = () => {
  const totals = { input: 0, output: 0, calls: 0, reported: 0 };
  activeMeters.add(totals);
  liveMeter = totals;
  notifyLive({ now: true });
  return {
    stop() {
      activeMeters.delete(totals);
      if (liveMeter === totals) {
        liveMeter = null;
        notifyLive({ now: true });
      }
      return { ...totals };
    },
  };
};

const recordInto = (meters, usage, estimate) => {
  const counts = normalizeUsage(usage);
  for (const totals of meters) {
    if (!activeMeters.has(totals)) continue;
    totals.calls += 1;
    if (!counts) {
      const guessed = unreported.get(totals) || { input: 0, output: 0 };
      unreported.set(totals, { input: guessed.input + estimate.input, output: guessed.output + estimate.output });
      continue;
    }
    totals.reported += 1;
    totals.input += counts.input;
    totals.output += counts.output;
  }
};

// One AI request, from send to finish. It counts toward the meters running
// when it was sent (and still running). finish(usage) records it with or
// without usage, so `calls` shows when some steps went unreported; cancel()
// drops it uncounted, as for a failed request.
export const trackRequest = (body) => {
  const request = { meters: new Set(activeMeters), input: estimateRequestTokens(body), outputChars: 0 };
  liveRequests.add(request);
  notifyLive();
  let open = true;
  const close = () => {
    if (!open) return false;
    open = false;
    liveRequests.delete(request);
    return true;
  };
  return {
    // Streamed text of any kind: reply, thinking, tool-call arguments.
    streamed(chars) {
      if (!open || !chars) return;
      request.outputChars += chars;
      notifyLive();
    },
    finish(usage) {
      if (!close()) return;
      recordInto(request.meters, usage, requestEstimate(request));
      notifyLive();
    },
    cancel() {
      if (close()) notifyLive();
    },
  };
};

// 842, 12.4k, 1.2M
export const formatTokenCount = (n) => {
  const value = Math.max(0, Number(n) || 0);
  if (value < 1000) return String(Math.round(value));
  const [divisor, suffix] = value < 999_950 ? [1000, 'k'] : [1_000_000, 'M'];
  const scaled = value / divisor;
  return `${scaled < 100 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.round(scaled)}${suffix}`;
};
