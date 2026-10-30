// The agent computer, page side of /api/computer (electron/server/computerApi.js).
// The build agents use it to run npm only: install or remove packages for real
// (package.json and package-lock.json), run `npm run build` on an imported
// codebase, and look up package details. The same fetch works in every host,
// and the per-install ID never reaches the page.
//
// Two switches decide whether it is used (Settings → Connectors → Agent
// computer): the on/off setting here, and a once-per-project question before
// a build check uploads a codebase's source code. Package names and versions
// are all that leave the machine otherwise.
import { safeStorage } from './config.js';

export const COMPUTER_KEY = 'orion-agent-computer';
const UPLOAD_OK_KEY = 'orion-agent-computer-uploads';

// On unless the user switched it off.
export function isComputerEnabled() {
  try {
    return safeStorage('local')?.getItem(COMPUTER_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setComputerEnabled(enabled) {
  try {
    safeStorage('local')?.setItem(COMPUTER_KEY, enabled ? 'on' : 'off');
  } catch { /* storage blocked: the switch just doesn't stick */ }
}

const readAllowed = () => {
  try {
    const list = JSON.parse(safeStorage('local')?.getItem(UPLOAD_OK_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const hasUploadConsent = (projectId) => readAllowed().includes(String(projectId));

export function rememberUploadConsent(projectId) {
  try {
    safeStorage('local')?.setItem(UPLOAD_OK_KEY, JSON.stringify([...new Set([...readAllowed(), String(projectId)])].slice(-200)));
  } catch { /* asked again next time */ }
}

// The question itself is a dialog App.jsx mounts (ComputerUploadConsent.jsx),
// which registers here. No dialog means no way to ask, so the answer is no.
let askUpload = null;
export const setUploadConsentPrompt = (fn) => { askUpload = fn; };

export async function confirmBuildUpload(projectId) {
  if (hasUploadConsent(projectId)) return true;
  if (!askUpload) return false;
  const ok = await askUpload();
  if (ok) rememberUploadConsent(projectId);
  return ok;
}

async function call(path, { method = 'POST', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { error: 'The agent computer isn’t reachable right now.', unavailable: true };
  }
  let answer;
  try {
    answer = await response.json();
  } catch {
    return { error: `The agent computer request failed (error ${response.status}).`, unavailable: true };
  }
  // Callers read fields off the answer, so anything but an object counts as no answer.
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return { error: `The agent computer sent back something unexpected (error ${response.status}).`, unavailable: true };
  }
  return answer;
}

// -> { available }
export const computerStatus = () => call('/api/computer', { method: 'GET' });

// -> { ok, packageJson, packageLock, log } | { ok: false, error, log } | { error, limited?, retryAfter?, unavailable? }
export const npmInstall = ({ projectId, packageJson, packageLock, add, remove, dev }) => call('/api/computer/npm/install', {
  body: { projectId: String(projectId), packageJson, packageLock: packageLock ?? null, add, remove, dev },
});

// -> { ok, exitCode, log } | { error, limited?, retryAfter?, unavailable? }
export const npmBuild = ({ projectId, files }) => call('/api/computer/npm/build', { body: { projectId: String(projectId), files } });

// -> { package: {...} } | { error }
export const inspectPackage = ({ name, version = null }) => call('/api/computer/npm/inspect', { body: { name, version } });

// "40 minutes" style wording for a limit message.
export function describeWait(seconds) {
  const minutes = Math.max(1, Math.ceil(Number(seconds) / 60));
  if (minutes < 90) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}
