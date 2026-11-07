// Hosted plans count usage once per user action (a prompt, a review), not per
// AI request: one prompt makes several requests (opening reply, the build,
// tool turns, repairs, the summary). Every request of an action shares that
// action's AbortSignal, so the signal is what ties them together: the first
// request sent with a signal gives it a random usage id, and every later one
// sends the same id. The server counts only the first request with a new id
// (electron/server/hosted/buildWindow.js). Retries reuse the signal, so they
// never count again.

const usages = new WeakMap();

const newUsageId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const usageFor = (signal) => {
  let usage = usages.get(signal);
  if (!usage) {
    usage = { id: newUsageId(), automaticRepair: false };
    usages.set(signal, usage);
  }
  return usage;
};

// The app's automatic repair of a build's errors (a pass the user didn't ask
// for) doesn't use up the plan: call before its first request.
export const markAutomaticRepair = (signal) => {
  if (signal) usageFor(signal).automaticRepair = true;
};

// Fields for a hosted /api/chat request body. A request without a signal
// gets no id, so the server counts it on its own.
export const usageFields = (signal) => {
  if (!signal) return {};
  const { id, automaticRepair } = usageFor(signal);
  return automaticRepair ? { usage_id: id, automatic_repair: true } : { usage_id: id };
};
