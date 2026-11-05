// Client-side bridge, terminal log store, and AI tool for the user's dedicated
// Render Sandbox computer (/api/sandbox/*).
//
// Each signed-in user has their own isolated Linux sandbox on Render with
// auto-idle suspension and filesystem snapshots. Commands run inside
// `/workspace`, stream stdout/stderr live to the builder UI and terminal log,
// and sync any modified text files back into the project's in-memory file map
// so the existing sandboxed browser preview updates immediately.

import { getAuthToken } from './authToken.js';
import { invalidArgumentsError } from './edits.js';
import { logWarn } from './errorLog.js';

export const SANDBOX_EXEC_TOOL_NAME = 'run_sandbox_command';
export const MAX_SANDBOX_COMMANDS_PER_REQUEST = 8;
const MAX_TOOL_OUTPUT_CHARS = 12_000;
const MAX_TERMINAL_LOG_ENTRIES = 50;

export const SANDBOX_EXEC_TOOL = {
  type: 'function',
  function: {
    name: SANDBOX_EXEC_TOOL_NAME,
    description: 'Run a shell command in the user\'s dedicated Linux sandbox computer (working directory /workspace, containing the project\'s files). Use this to run scripts, tests, linters, builds, install npm packages, or inspect/transform files with standard CLI tools. Any text files created or modified in /workspace are synced back to the live preview.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to run inside /workspace (for example "node --check index.js" or "npm test").',
        },
        sync_files_back: {
          type: ['boolean', 'null'],
          description: 'True to sync modified or newly created files in /workspace back into the project preview. Null defaults to true.',
        },
      },
      required: ['command', 'sync_files_back'],
      additionalProperties: false,
    },
    strict: true,
  },
};

export const SANDBOX_COMPUTER_GUIDANCE = 'SANDBOX COMPUTER: You have access to the user\'s dedicated Linux computer via `run_sandbox_command` (working directory `/workspace`). The project\'s files are synced into `/workspace` in a single archive before your command runs, and any text files created or modified inside `/workspace` are synced back into the live preview when `sync_files_back` is true.';

let sandboxComputerEnabled = false;
let terminalEntries = [];
let nextEntryId = 1;
const terminalListeners = new Set();

const notifyTerminalListeners = () => {
  for (const listener of terminalListeners) {
    try { listener(terminalEntries); } catch { /* ignore listener error */ }
  }
};

export const getSandboxTerminalLog = () => terminalEntries;

export const clearSandboxTerminalLog = () => {
  terminalEntries = [];
  notifyTerminalListeners();
};

export const subscribeSandboxTerminal = (listener) => {
  if (typeof listener !== 'function') return () => {};
  terminalListeners.add(listener);
  return () => { terminalListeners.delete(listener); };
};

function appendTerminalEntry(command) {
  const entry = {
    id: nextEntryId++,
    command,
    stdout: '',
    stderr: '',
    exitCode: null,
    running: true,
    startedAt: new Date().toISOString(),
  };
  terminalEntries = [...terminalEntries.slice(-(MAX_TERMINAL_LOG_ENTRIES - 1)), entry];
  notifyTerminalListeners();
  return entry.id;
}

function updateTerminalEntry(id, patch) {
  terminalEntries = terminalEntries.map((item) => (item.id === id ? { ...item, ...patch } : item));
  notifyTerminalListeners();
}

export const isSandboxComputerEnabled = () => sandboxComputerEnabled;

export const setSandboxComputerEnabled = (enabled) => {
  sandboxComputerEnabled = Boolean(enabled);
};

export const isSandboxToolCall = (toolCall) => toolCall?.function?.name === SANDBOX_EXEC_TOOL_NAME;

export const createSandboxBudget = (max = MAX_SANDBOX_COMMANDS_PER_REQUEST) => ({ left: max, used: 0 });

const withAuth = async (init = {}) => {
  const token = await getAuthToken();
  return {
    ...init,
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  };
};

export async function fetchSandboxStatus({ signal } = {}) {
  try {
    const res = await fetch('/api/sandbox/status', await withAuth({ signal }));
    if (!res.ok) return { configured: false, sandboxId: null, snapshotId: null };
    const data = await res.json();
    const configured = Boolean(data?.configured);
    sandboxComputerEnabled = configured;
    return {
      configured,
      sandboxId: data?.sandboxId || null,
      snapshotId: data?.snapshotId || null,
    };
  } catch {
    return { configured: false, sandboxId: null, snapshotId: null };
  }
}

export async function ensureSandboxComputer({ files, signal } = {}) {
  const res = await fetch('/api/sandbox/ensure', await withAuth({
    method: 'POST',
    body: JSON.stringify(files ? { files } : {}),
    signal,
  }));
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Could not start sandbox computer.');
  return data;
}

export async function snapshotSandboxComputer({ signal } = {}) {
  const res = await fetch('/api/sandbox/snapshot', await withAuth({
    method: 'POST',
    body: JSON.stringify({}),
    signal,
  }));
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Could not snapshot sandbox computer.');
  return data;
}

async function readSandboxSse(body, { onOutput }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data = '';
  let exitPayload = null;

  const handleLine = (line) => {
    if (line === '') {
      if (!event && !data) return;
      let parsed = null;
      try { parsed = JSON.parse(data); } catch { /* ignore malformed chunk */ }
      if (event === 'output' && parsed) {
        onOutput?.({ stream: parsed.stream === 'stderr' ? 'stderr' : 'stdout', data: String(parsed.data ?? '') });
      } else if (event === 'exit' && parsed) {
        exitPayload = parsed;
      } else if (event === 'error' && parsed) {
        throw new Error(parsed.message || 'Sandbox command failed.');
      }
      event = '';
      data = '';
      return;
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      if (data) data += '\n';
      data += line.slice(5).replace(/^ /, '');
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        handleLine(line);
        idx = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer) handleLine(buffer.replace(/\r$/, ''));
    handleLine('');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  return exitPayload;
}

export async function execInSandboxComputer({
  command,
  files,
  syncBack = true,
  onOutput,
  signal,
} = {}) {
  const entryId = appendTerminalEntry(command);
  let liveStdout = '';
  let liveStderr = '';

  const recordOutput = (chunk) => {
    if (chunk.stream === 'stderr') liveStderr += chunk.data;
    else liveStdout += chunk.data;
    updateTerminalEntry(entryId, { stdout: liveStdout, stderr: liveStderr });
    onOutput?.(chunk);
  };

  try {
    const res = await fetch('/api/sandbox/exec', await withAuth({
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      body: JSON.stringify({ command, files, syncBack, stream: true }),
      signal,
    }));

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(errBody?.error || `Sandbox command failed (${res.status}).`);
    }

    if (contentType.includes('text/event-stream') && res.body) {
      const exitPayload = await readSandboxSse(res.body, { onOutput: recordOutput });
      if (!exitPayload) throw new Error('Sandbox stream ended without an exit event.');
      updateTerminalEntry(entryId, {
        stdout: exitPayload.stdout ?? liveStdout,
        stderr: exitPayload.stderr ?? liveStderr,
        exitCode: exitPayload.exitCode ?? 0,
        running: false,
      });
      return exitPayload;
    }

    const data = await res.json();
    if (data?.stdout) recordOutput({ stream: 'stdout', data: data.stdout });
    if (data?.stderr) recordOutput({ stream: 'stderr', data: data.stderr });
    updateTerminalEntry(entryId, {
      stdout: data?.stdout ?? liveStdout,
      stderr: data?.stderr ?? liveStderr,
      exitCode: data?.exitCode ?? 0,
      running: false,
    });
    return data;
  } catch (err) {
    updateTerminalEntry(entryId, {
      stderr: `${liveStderr}${liveStderr ? '\n' : ''}${err instanceof Error ? err.message : String(err)}`,
      exitCode: 1,
      running: false,
    });
    throw err;
  }
}

const truncateOutput = (text) => {
  const str = String(text || '');
  return str.length > MAX_TOOL_OUTPUT_CHARS
    ? `${str.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n… [truncated ${str.length - MAX_TOOL_OUTPUT_CHARS} chars]`
    : str;
};

// Executes a `run_sandbox_command` tool call against the user's Render Sandbox
// and merges any changed files in `/workspace` back into `state.files`.
export async function executeSandboxToolCall(
  state,
  toolCall,
  budget,
  { onChunk, signal, exec = execInSandboxComputer } = {},
) {
  let args;
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch (err) {
    logWarn(`run_sandbox_command arguments were not valid JSON. Model sent: ${String(toolCall.function?.arguments ?? '').slice(0, 300)}`, err);
    return { state, applied: false, result: { success: false, error: invalidArgumentsError(err) } };
  }

  const command = typeof args?.command === 'string' ? args.command.trim() : '';
  if (!command) {
    return { state, applied: false, result: { success: false, error: 'command must be a non-empty string.' } };
  }
  if (budget && budget.left <= 0) {
    return {
      state,
      applied: false,
      result: {
        success: false,
        error: 'The sandbox command limit for this request has been reached. Continue using the file tools directly.',
      },
    };
  }
  if (budget) {
    budget.left--;
    budget.used = (budget.used || 0) + 1;
  }

  const syncBack = args.sync_files_back !== false;
  onChunk?.(`Running on your computer: ${command.slice(0, 80)}${command.length > 80 ? '…' : ''}`, 'status');

  try {
    const outcome = await exec({
      command,
      files: state.files,
      syncBack,
      signal,
      onOutput: ({ data }) => {
        const line = String(data || '').trim().split(/\r?\n/).pop();
        if (line) onChunk?.(`$ ${command.slice(0, 40)}: ${line.slice(0, 80)}`, 'status');
      },
    });

    let nextState = state;
    let applied = false;
    const changedFiles = [];

    if (syncBack && outcome?.files && typeof outcome.files === 'object') {
      const mergedFiles = { ...state.files };
      for (const [path, content] of Object.entries(outcome.files)) {
        if (typeof content === 'string' && mergedFiles[path] !== content) {
          mergedFiles[path] = content;
          changedFiles.push(path);
        }
      }
      if (changedFiles.length > 0) {
        nextState = { ...state, files: mergedFiles };
        applied = true;
      }
    }

    return {
      state: nextState,
      applied,
      result: {
        success: outcome.exitCode === 0,
        exitCode: outcome.exitCode,
        stdout: truncateOutput(outcome.stdout),
        stderr: truncateOutput(outcome.stderr),
        changedFiles,
      },
    };
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    return {
      state,
      applied: false,
      result: {
        success: false,
        error: `Sandbox command failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}
