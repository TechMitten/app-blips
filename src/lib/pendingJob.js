// Pending-job persistence — no React, no hooks, safe to call anywhere.
//
// A "pending job" is written to localStorage the moment a generation starts
// and cleared as soon as the generation resolves (success, explicit cancel, or
// unrecoverable error). If the page is closed / navigated away mid-stream the
// key survives, and on the next load the app can detect the interrupted build
// and offer to retry it.

const PENDING_JOB_KEY = 'orion-pending-job';

/**
 * @typedef {Object} PendingJob
 * @property {string|null} projectId   - The project being edited (null for brand-new apps).
 * @property {string}      prompt      - The prompt that triggered the build.
 * @property {string}      chatMode    - 'build' or 'ask'.
 * @property {string}      [studioMode] - 'app' or 'website' (legacy records predate this field).
 * @property {number}      startedAt   - Date.now() timestamp when the job began.
 */

/**
 * Persist the current in-flight job. Call this immediately before awaiting
 * `generateAppCode` so the record is written even if the page closes mid-stream.
 * @param {PendingJob} job
 */
export const savePendingJob = (job) => {
  try {
    localStorage.setItem(PENDING_JOB_KEY, JSON.stringify(job));
  } catch {
    // Storage blocked or full — silently skip; the feature degrades gracefully.
  }
};

/**
 * Remove the pending job record. Call this on success, on explicit user cancel,
 * and on unrecoverable error (user already sees the error message).
 */
export const clearPendingJob = () => {
  try {
    localStorage.removeItem(PENDING_JOB_KEY);
  } catch { /* ignore */ }
};

/**
 * Read the persisted pending job, if any.
 * @returns {PendingJob|null}
 */
export const loadPendingJob = () => {
  try {
    const raw = localStorage.getItem(PENDING_JOB_KEY);
    if (!raw) return null;
    const job = JSON.parse(raw);
    // Basic shape guard
    if (!job || typeof job.prompt !== 'string') return null;
    return job;
  } catch {
    return null;
  }
};
