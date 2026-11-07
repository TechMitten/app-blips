// Per-user Render Sandbox ("agent + computer" pair) manager and HTTP handler.
//
// Each signed-in user gets at most one dedicated Render Sandbox stored on their
// account row (`sandbox_id` + `sandbox_snapshot_id` in store.js). Sandboxes are
// created with `timeoutSeconds: 0` (no hard lifetime limit) and
// `idleTimeoutSeconds: 300` (auto-sleep after 5 minutes of inactivity, waking
// automatically on the next command or file transfer). If a sandbox is ever
// terminated or replaced, the next session restores from `sandbox_snapshot_id`.
//
// Project files are synced into `/workspace` in a single request using a POSIX
// ustar `.tar` archive (`application/x-tar`), so multi-file codebases upload in
// one round-trip with no separate mkdir pass.
//
// Uses plain Fetch primitives so the server bundle (scripts/build-server.js)
// stays a single file with no extra runtime node_modules.

import { posix } from 'node:path';
import { verifyClerkToken } from './clerk.js';
import { validateProjectPath } from '../../../src/lib/codebase/paths.js';
import { isHosted } from './mode.js';

export const WORKSPACE_ROOT = '/workspace';
export const DEFAULT_TIMEOUT_SECONDS = 0;
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 300;
const DEFAULT_WAIT_INTERVAL_MS = 250;
const DEFAULT_WAIT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 64_000;
const IMAGE_ID_PATTERN = /^sbb-[0-9a-v]{20}$/;

// In-flight provisioning promises keyed by userId, so concurrent tool calls
// from the same user share one sandbox creation instead of racing.
const inflightByUser = new Map();
let cachedWorkspaceByKey = { apiKey: '', workspaceId: '' };

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

export const renderBaseUrl = (env) => String(env?.RENDER_API_BASE_URL || 'https://api.render.com/v1').replace(/\/+$/, '');
export const renderApiKey = (env) => String(env?.RENDER_API_KEY || '').trim();
export const renderWorkspaceId = (env) => String(env?.RENDER_WORKSPACE_ID || '').trim();
export const renderSandboxConfigured = (env) => Boolean(renderApiKey(env));

// Picks the Render compute plan for a user's subscription tier (`basic`,
// `silver`, `max`), falling back to `RENDER_SANDBOX_PLAN`.
export function sandboxPlanForTier(env, tier = 'basic') {
  const key = `RENDER_SANDBOX_PLAN_${String(tier || 'basic').toUpperCase()}`;
  const specific = String(env?.[key] || '').trim();
  if (specific) return specific;
  return String(env?.RENDER_SANDBOX_PLAN || '').trim();
}

// Builds a Render networkPolicy when `RENDER_SANDBOX_ALLOW_DOMAINS` is set
// (comma-separated domains, e.g. "registry.npmjs.org,*.npmjs.org,esm.sh").
export function sandboxNetworkPolicy(env) {
  const raw = String(env?.RENDER_SANDBOX_ALLOW_DOMAINS || '').trim();
  if (!raw) return null;
  if (raw.toLowerCase() === 'deny-all') return { type: 'deny-all' };
  const domains = raw.split(',').map((d) => d.trim()).filter(Boolean);
  if (!domains.length) return null;
  return {
    type: 'allow-list',
    rules: domains.map((domain) => ({ domain })),
  };
}

export async function resolveRenderWorkspaceId(env, { signal } = {}) {
  const explicit = renderWorkspaceId(env);
  if (explicit) return explicit;
  const apiKey = renderApiKey(env);
  if (!apiKey) throw new Error('RENDER_API_KEY is not configured on this server.');
  if (cachedWorkspaceByKey.apiKey === apiKey && cachedWorkspaceByKey.workspaceId) {
    return cachedWorkspaceByKey.workspaceId;
  }
  const res = await renderRequest(env, 'GET', '/owners?limit=20', undefined, { signal });
  const list = Array.isArray(res.data) ? res.data : [];
  const ownerId = list.map((item) => item?.owner?.id || item?.id).find((id) => typeof id === 'string' && id.startsWith('tea-'));
  if (!ownerId) {
    throw new Error('Could not find a Render workspace (tea-...) for this RENDER_API_KEY. Set RENDER_WORKSPACE_ID explicitly.');
  }
  cachedWorkspaceByKey = { apiKey, workspaceId: ownerId };
  return ownerId;
}

function cleanWorkspacePath(relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error('A workspace-relative file path is required.');
  }
  const trimmed = relPath.trim().replace(/^\.\//, '').replace(/^\/+/, '');
  const problem = validateProjectPath(trimmed);
  if (problem) throw new Error(problem);
  const full = posix.normalize(`${WORKSPACE_ROOT}/${trimmed}`);
  if (!full.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new Error(`Invalid workspace path: ${relPath}`);
  }
  return { relative: trimmed, full };
}

// Packs `{ [relativePath]: string | Buffer }` into an uncompressed POSIX ustar
// tar archive so an entire project uploads to `/workspace` in one HTTP request.
export function packTarArchive(files) {
  const blocks = [];
  const mtimeOctal = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';

  for (const [rawPath, content] of Object.entries(files)) {
    const { relative } = cleanWorkspacePath(rawPath);
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const header = Buffer.alloc(512, 0);

    let name = relative;
    let prefix = '';
    if (Buffer.byteLength(name, 'utf8') > 100) {
      const slash = name.lastIndexOf('/');
      if (slash > 0) {
        prefix = name.slice(0, slash);
        name = name.slice(slash + 1);
      }
    }

    header.write(name, 0, Math.min(100, Buffer.byteLength(name)), 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write(mtimeOctal, 136, 12, 'ascii');
    header.write('        ', 148, 8, 'ascii');
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    if (prefix) {
      header.write(prefix, 345, Math.min(155, Buffer.byteLength(prefix)), 'utf8');
    }

    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

    blocks.push(header);
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad, 0));
  }

  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

export async function renderRequest(env, method, path, body, { signal } = {}) {
  const apiKey = renderApiKey(env);
  if (!apiKey) throw new Error('RENDER_API_KEY is not configured on this server.');
  const res = await fetch(`${renderBaseUrl(env)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { ok: res.ok, status: res.status, data, text };
}

export async function getSandbox(env, sandboxId, { signal } = {}) {
  const ownerId = await resolveRenderWorkspaceId(env, { signal });
  return renderRequest(
    env,
    'GET',
    `/sandboxes/${encodeURIComponent(sandboxId)}?ownerId=${encodeURIComponent(ownerId)}`,
    undefined,
    { signal },
  );
}

export async function createSandbox(env, { snapshotId = null, tier = 'basic', signal } = {}) {
  const ownerId = await resolveRenderWorkspaceId(env, { signal });

  const image = String(env?.RENDER_SANDBOX_IMAGE || '').trim();
  const groupId = String(env?.RENDER_SANDBOX_GROUP_ID || '').trim();
  const plan = sandboxPlanForTier(env, tier);
  const networkPolicy = sandboxNetworkPolicy(env);

  const body = {
    ownerId,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    idleTimeoutSeconds: DEFAULT_IDLE_TIMEOUT_SECONDS,
    ...(groupId ? { sandboxGroupId: groupId } : {}),
    ...(plan ? { plan } : {}),
    ...(networkPolicy ? { networkPolicy } : {}),
  };

  if (snapshotId) {
    body.snapshotId = snapshotId;
  } else if (image) {
    if (IMAGE_ID_PATTERN.test(image)) body.buildId = image;
    else body.buildName = image;
  }

  return renderRequest(env, 'POST', '/sandboxes', body, { signal });
}

export async function terminateSandbox(env, sandboxId, { signal } = {}) {
  const ownerId = await resolveRenderWorkspaceId(env, { signal });
  return renderRequest(
    env,
    'POST',
    `/sandboxes/${encodeURIComponent(sandboxId)}/terminate?ownerId=${encodeURIComponent(ownerId)}`,
    undefined,
    { signal },
  );
}

export async function createSandboxSnapshot(env, sandboxId, { kind = 'filesystem', name, signal } = {}) {
  const ownerId = await resolveRenderWorkspaceId(env, { signal });
  return renderRequest(
    env,
    'POST',
    `/sandboxes/${encodeURIComponent(sandboxId)}/snapshots?ownerId=${encodeURIComponent(ownerId)}`,
    { kind, ...(name ? { name } : {}) },
    { signal },
  );
}

export async function deleteSandboxSnapshot(env, sandboxGroupId, snapshotId, { signal } = {}) {
  if (!sandboxGroupId || !snapshotId) return { ok: false, status: 400 };
  const ownerId = await resolveRenderWorkspaceId(env, { signal });
  return renderRequest(
    env,
    'DELETE',
    `/sandbox-groups/${encodeURIComponent(sandboxGroupId)}/snapshots/${encodeURIComponent(snapshotId)}?ownerId=${encodeURIComponent(ownerId)}`,
    undefined,
    { signal },
  );
}

// Captures a new filesystem snapshot for the user's sandbox, saves it to SQLite,
// and deletes the user's superseded snapshot so snapshots never accumulate.
export async function captureUserSandboxSnapshot(userId, env, store, { signal } = {}) {
  const account = (await store?.getAccount(userId)) || null;
  const previousSnapshotId = account?.sandbox_snapshot_id || null;
  const ensured = await ensureUserSandbox(userId, env, store, { signal });
  const snapRes = await createSandboxSnapshot(env, ensured.sandboxId, {
    kind: 'filesystem',
    signal,
  });
  if (!snapRes.ok || !snapRes.data?.id) {
    throw new Error(snapRes.data?.message || 'Failed to capture sandbox snapshot.');
  }
  const newSnapshotId = snapRes.data.id;
  const groupId = snapRes.data.sandboxGroupId || String(env?.RENDER_SANDBOX_GROUP_ID || '').trim();
  await store?.setSandbox(userId, { sandboxId: ensured.sandboxId, snapshotId: newSnapshotId });

  if (previousSnapshotId && previousSnapshotId !== newSnapshotId && groupId) {
    await deleteSandboxSnapshot(env, groupId, previousSnapshotId, { signal }).catch(() => {});
  }

  return {
    sandboxId: ensured.sandboxId,
    snapshotId: newSnapshotId,
    replacedSnapshotId: previousSnapshotId !== newSnapshotId ? previousSnapshotId : null,
    status: snapRes.data.status,
  };
}

// Polls until the sandbox reaches `running`. If the sandbox is `suspended`,
// requesting a run connect token triggers Render's auto-resume.
export async function waitUntilSandboxRunning(
  env,
  sandboxId,
  { timeoutMs = DEFAULT_WAIT_TIMEOUT_MS, intervalMs = DEFAULT_WAIT_INTERVAL_MS, signal } = {},
) {
  const started = Date.now();
  let delay = intervalMs;
  let wokeSuspended = false;

  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const res = await getSandbox(env, sandboxId, { signal });
    if (res.status === 404) {
      const err = new Error(`Sandbox ${sandboxId} was not found.`);
      err.ended = true;
      throw err;
    }
    if (!res.ok) {
      throw new Error(res.data?.message || `Failed to check sandbox ${sandboxId} (${res.status}).`);
    }
    const sandbox = res.data;
    if (sandbox?.status === 'running') return sandbox;
    if (sandbox?.status === 'terminated' || sandbox?.status === 'errored') {
      const err = new Error(`Sandbox ${sandboxId} is ${sandbox.status}.`);
      err.ended = true;
      throw err;
    }
    if (sandbox?.status === 'suspended' && !wokeSuspended) {
      wokeSuspended = true;
      const ownerId = await resolveRenderWorkspaceId(env, { signal });
      await renderRequest(
        env,
        'POST',
        `/sandboxes/${encodeURIComponent(sandboxId)}/runs/stream/token?ownerId=${encodeURIComponent(ownerId)}`,
        { command: 'true' },
        { signal },
      ).catch(() => {});
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Timed out waiting for sandbox ${sandboxId} to start.`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, Math.max(2000, intervalMs));
  }
}

// Ensures the user has a running Render Sandbox, creating or restoring one
// from their latest filesystem snapshot when needed.
export async function ensureUserSandbox(userId, env, store, { signal, waitOptions } = {}) {
  if (!userId) throw new Error('userId is required.');
  if (!renderSandboxConfigured(env)) {
    throw new Error('Render Sandboxes are not configured on this server (missing RENDER_API_KEY).');
  }

  const inflight = inflightByUser.get(userId);
  if (inflight) return inflight;

  const task = (async () => {
    const account = (await store?.getAccount(userId)) || null;
    const existingId = account?.sandbox_id || null;
    const snapshotId = account?.sandbox_snapshot_id || null;
    const tier = account?.plan || 'basic';

    if (existingId) {
      try {
        const running = await waitUntilSandboxRunning(env, existingId, { ...waitOptions, signal });
        return {
          sandboxId: running.id,
          snapshotId,
          status: running.status,
          created: false,
          restoredFromSnapshot: false,
        };
      } catch (err) {
        if (!err?.ended) throw err;
        // Sandbox ended or was deleted; clear it and create a replacement below.
        await store?.setSandbox(userId, { sandboxId: null });
      }
    }

    let createRes = await createSandbox(env, { snapshotId, tier, signal });
    let restoredFromSnapshot = Boolean(snapshotId);
    // If the saved snapshot expired or was deleted on Render, fall back to a
    // clean base sandbox rather than locking the user out.
    if (!createRes.ok && snapshotId && (createRes.status === 404 || createRes.status === 400 || createRes.status === 409)) {
      await store?.setSandbox(userId, { sandboxId: null, snapshotId: null });
      createRes = await createSandbox(env, { snapshotId: null, tier, signal });
      restoredFromSnapshot = false;
    }
    if (!createRes.ok || !createRes.data?.id) {
      throw new Error(createRes.data?.message || `Failed to create Render sandbox (${createRes.status}).`);
    }

    const createdId = createRes.data.id;
    await store?.setSandbox(userId, { sandboxId: createdId });

    const running = createRes.data.status === 'running'
      ? createRes.data
      : await waitUntilSandboxRunning(env, createdId, { ...waitOptions, signal });

    return {
      sandboxId: running.id,
      snapshotId: restoredFromSnapshot ? snapshotId : null,
      status: running.status,
      created: true,
      restoredFromSnapshot,
    };
  })();

  inflightByUser.set(userId, task);
  try {
    return await task;
  } finally {
    if (inflightByUser.get(userId) === task) {
      inflightByUser.delete(userId);
    }
  }
}

async function* parseRenderSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data = '';

  const flushLine = (line) => {
    if (line === '') {
      if (!event && !data) return null;
      const item = { event, data };
      event = '';
      data = '';
      return item;
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      if (data) data += '\n';
      data += line.slice(5).replace(/^ /, '');
    }
    return null;
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
        const item = flushLine(line);
        if (item) yield item;
        idx = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const item = flushLine(buffer.replace(/\r$/, ''));
      if (item) yield item;
    }
    const finalItem = flushLine('');
    if (finalItem) yield finalItem;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Runs a shell command inside the sandbox using Render's two-step stream
// connect token flow.
export async function execSandboxCommand(env, sandboxId, command, { onOutput, signal } = {}) {
  const ownerId = await resolveRenderWorkspaceId(env, { signal });
  const tokenRes = await renderRequest(
    env,
    'POST',
    `/sandboxes/${encodeURIComponent(sandboxId)}/runs/stream/token?ownerId=${encodeURIComponent(ownerId)}`,
    { command },
    { signal },
  );
  if (!tokenRes.ok || !tokenRes.data?.uri || !tokenRes.data?.token) {
    const err = new Error(tokenRes.data?.message || `Failed to obtain sandbox exec token (${tokenRes.status}).`);
    err.status = tokenRes.status;
    throw err;
  }

  const streamRes = await fetch(tokenRes.data.uri, {
    method: tokenRes.data.method || 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${tokenRes.data.token}`,
    },
    body: JSON.stringify({ command }),
    signal,
  });

  if (!streamRes.ok || !streamRes.body) {
    const text = await streamRes.text().catch(() => '');
    throw new Error(text || `Sandbox command stream failed (${streamRes.status}).`);
  }

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let sawExit = false;

  for await (const item of parseRenderSse(streamRes.body)) {
    let parsed;
    try { parsed = JSON.parse(item.data); } catch { continue; }
    if (item.event === 'output') {
      const streamName = parsed.stream === 'stderr' ? 'stderr' : 'stdout';
      const chunk = String(parsed.data ?? '');
      if (streamName === 'stderr') {
        if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.slice(0, MAX_OUTPUT_CHARS - stderr.length);
      } else if (stdout.length < MAX_OUTPUT_CHARS) {
        stdout += chunk.slice(0, MAX_OUTPUT_CHARS - stdout.length);
      }
      onOutput?.({ stream: streamName, data: chunk });
    } else if (item.event === 'exit') {
      exitCode = typeof parsed.exit_code === 'number' ? parsed.exit_code : 0;
      sawExit = true;
      break;
    } else if (item.event === 'error') {
      throw new Error(parsed.message || 'Sandbox command execution error.');
    }
  }

  if (!sawExit) {
    throw new Error('Sandbox exec stream ended without an exit event.');
  }

  return { stdout, stderr, exitCode };
}

export async function uploadSandboxFile(
  env,
  sandboxId,
  relPath,
  content,
  { contentType = 'application/octet-stream', signal } = {},
) {
  const { full } = cleanWorkspacePath(relPath);
  const ownerId = await resolveRenderWorkspaceId(env, { signal });
  const tokenRes = await renderRequest(
    env,
    'POST',
    `/sandboxes/${encodeURIComponent(sandboxId)}/files/upload/token?ownerId=${encodeURIComponent(ownerId)}&path=${encodeURIComponent(full)}`,
    undefined,
    { signal },
  );
  if (!tokenRes.ok || !tokenRes.data?.uri || !tokenRes.data?.token) {
    throw new Error(tokenRes.data?.message || `Failed to obtain file upload token for ${relPath} (${tokenRes.status}).`);
  }

  const body = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const uploadRes = await fetch(tokenRes.data.uri, {
    method: tokenRes.data.method || 'PUT',
    headers: {
      authorization: `Bearer ${tokenRes.data.token}`,
      'content-type': contentType,
    },
    body,
    signal,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => '');
    throw new Error(text || `Failed to upload ${relPath} to sandbox (${uploadRes.status}).`);
  }
}

export async function downloadSandboxFile(env, sandboxId, relPath, { signal } = {}) {
  const { full, relative } = cleanWorkspacePath(relPath);
  const ownerId = await resolveRenderWorkspaceId(env, { signal });
  const tokenRes = await renderRequest(
    env,
    'POST',
    `/sandboxes/${encodeURIComponent(sandboxId)}/files/download/token?ownerId=${encodeURIComponent(ownerId)}&path=${encodeURIComponent(full)}`,
    undefined,
    { signal },
  );
  if (!tokenRes.ok || !tokenRes.data?.uri || !tokenRes.data?.token) {
    throw new Error(tokenRes.data?.message || `Failed to obtain file download token for ${relative} (${tokenRes.status}).`);
  }

  const downloadRes = await fetch(tokenRes.data.uri, {
    method: tokenRes.data.method || 'GET',
    headers: {
      authorization: `Bearer ${tokenRes.data.token}`,
    },
    signal,
  });

  if (!downloadRes.ok) {
    const text = await downloadRes.text().catch(() => '');
    throw new Error(text || `Failed to download ${relative} from sandbox (${downloadRes.status}).`);
  }

  const bytes = Buffer.from(await downloadRes.arrayBuffer());
  return {
    path: relative,
    data: bytes,
    text: bytes.toString('utf8'),
    size: bytes.byteLength,
    contentType: downloadRes.headers.get('content-type') || 'application/octet-stream',
  };
}

// Uploads all files in `files` to `/workspace` in a single request using a
// POSIX ustar `.tar` archive (`Content-Type: application/x-tar`).
export async function syncFilesToSandbox(env, sandboxId, files, { signal } = {}) {
  if (!files || typeof files !== 'object') return [];
  const entries = Object.entries(files).filter(([, value]) => typeof value === 'string');
  if (!entries.length) return [];

  const validated = {};
  const uploaded = [];
  for (const [relPath, text] of entries) {
    const { relative } = cleanWorkspacePath(relPath);
    validated[relative] = text;
    uploaded.push(relative);
  }

  const tarBuffer = packTarArchive(validated);
  const ownerId = await resolveRenderWorkspaceId(env, { signal });
  const tokenRes = await renderRequest(
    env,
    'POST',
    `/sandboxes/${encodeURIComponent(sandboxId)}/files/upload/token?ownerId=${encodeURIComponent(ownerId)}&path=${encodeURIComponent(WORKSPACE_ROOT)}`,
    undefined,
    { signal },
  );
  if (!tokenRes.ok || !tokenRes.data?.uri || !tokenRes.data?.token) {
    throw new Error(tokenRes.data?.message || `Failed to obtain workspace tar upload token (${tokenRes.status}).`);
  }

  const uploadRes = await fetch(tokenRes.data.uri, {
    method: tokenRes.data.method || 'PUT',
    headers: {
      authorization: `Bearer ${tokenRes.data.token}`,
      'content-type': 'application/x-tar',
    },
    body: tarBuffer,
    signal,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => '');
    throw new Error(text || `Failed to upload workspace tar archive (${uploadRes.status}).`);
  }

  return uploaded;
}

// Reads text files back from /workspace so edits or generated files from a
// sandbox command can immediately update AppBlips's in-browser preview.
const SYNC_FROM_WORKSPACE_SCRIPT = `node -e '
const fs = require("fs");
const path = require("path");
const root = ${JSON.stringify(WORKSPACE_ROOT)};
const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);
const out = {};
function walk(dir, relBase) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = relBase ? relBase + "/" + entry.name : entry.name;
    if (entry.isDirectory()) {
      walk(full, rel);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(full);
        if (stat.size > 512 * 1024) continue;
        const buf = fs.readFileSync(full);
        if (buf.includes(0)) continue;
        out[rel] = buf.toString("utf8");
      } catch {}
    }
  }
}
walk(root, "");
process.stdout.write(JSON.stringify(out));
'`;

export async function syncFilesFromSandbox(env, sandboxId, { signal } = {}) {
  const { stdout, exitCode } = await execSandboxCommand(env, sandboxId, SYNC_FROM_WORKSPACE_SCRIPT, { signal });
  if (exitCode !== 0 || !stdout.trim()) return {};
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const valid = {};
    for (const [relPath, content] of Object.entries(parsed)) {
      if (typeof content !== 'string') continue;
      if (validateProjectPath(relPath) === null) valid[relPath] = content;
    }
    return valid;
  } catch {
    return {};
  }
}

async function resolveSandboxUser(request, env, store) {
  // The sandbox computer is a paid-plan feature: it runs on the operator's
  // Render account, so a server without accounts (local installs, own-key
  // users) never hands it out, even with RENDER_API_KEY set.
  if (!isHosted(env)) {
    return {
      response: json(403, {
        error: 'The agent computer is only available on AppBlips plans.',
        code: 'plan_required',
      }),
    };
  }
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { response: json(401, { error: 'Sign in to continue.' }) };

  let userId;
  try {
    userId = (await verifyClerkToken(token, env)).sub;
  } catch {
    return { response: json(401, { error: 'Your session has expired. Sign in again.' }) };
  }

  const account = await store?.getAccount(userId);
  if (!account?.active) {
    return {
      response: json(402, {
        error: 'A subscription is required to use your agent computer. Choose a plan to start building.',
        code: 'subscription_required',
      }),
    };
  }
  return { userId, account };
}

export async function handleSandbox(request, env, store) {
  const { pathname, searchParams } = new URL(request.url);

  if (pathname === '/api/sandbox/status') {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' });
    const configured = renderSandboxConfigured(env);
    const auth = await resolveSandboxUser(request, env, store);
    if (auth.response) return auth.response;
    const account = (await store?.getAccount(auth.userId)) || null;
    return json(200, {
      configured,
      sandboxId: account?.sandbox_id || null,
      snapshotId: account?.sandbox_snapshot_id || null,
    });
  }

  if (!renderSandboxConfigured(env)) {
    return json(503, {
      error: 'Render Sandboxes are not configured on this server. Set RENDER_API_KEY.',
      code: 'sandbox_not_configured',
    });
  }

  const auth = await resolveSandboxUser(request, env, store);
  if (auth.response) return auth.response;
  const { userId } = auth;

  try {
    if (pathname === '/api/sandbox/ensure') {
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
      const body = await request.json().catch(() => ({}));
      const ensured = await ensureUserSandbox(userId, env, store, { signal: request.signal });
      let uploaded = [];
      if (body?.files && typeof body.files === 'object') {
        uploaded = await syncFilesToSandbox(env, ensured.sandboxId, body.files, { signal: request.signal });
      }
      return json(200, { ...ensured, uploaded });
    }

    if (pathname === '/api/sandbox/exec') {
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
      const body = await request.json().catch(() => null);
      const rawCommand = typeof body?.command === 'string' ? body.command.trim() : '';
      if (!rawCommand) return json(400, { error: 'A command string is required.' });

      const ensured = await ensureUserSandbox(userId, env, store, { signal: request.signal });
      if (body?.files && typeof body.files === 'object') {
        await syncFilesToSandbox(env, ensured.sandboxId, body.files, { signal: request.signal });
      }

      const wrappedCommand = `mkdir -p '${WORKSPACE_ROOT}' && cd '${WORKSPACE_ROOT}' && ${rawCommand}`;
      const wantsSse = (request.headers.get('accept') || '').includes('text/event-stream') || body?.stream === true;

      if (wantsSse) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const sendEvent = (event, payload) => {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
            };
            try {
              const result = await execSandboxCommand(env, ensured.sandboxId, wrappedCommand, {
                signal: request.signal,
                onOutput: (chunk) => sendEvent('output', chunk),
              });
              const syncedFiles = body?.syncBack
                ? await syncFilesFromSandbox(env, ensured.sandboxId, { signal: request.signal })
                : undefined;
              sendEvent('exit', {
                sandboxId: ensured.sandboxId,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                ...(syncedFiles ? { files: syncedFiles } : {}),
              });
            } catch (err) {
              sendEvent('error', { message: err instanceof Error ? err.message : String(err) });
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
          },
        });
      }

      const result = await execSandboxCommand(env, ensured.sandboxId, wrappedCommand, { signal: request.signal });
      const syncedFiles = body?.syncBack
        ? await syncFilesFromSandbox(env, ensured.sandboxId, { signal: request.signal })
        : undefined;

      return json(200, {
        sandboxId: ensured.sandboxId,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        ...(syncedFiles ? { files: syncedFiles } : {}),
      });
    }

    if (pathname === '/api/sandbox/upload') {
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
      const body = await request.json().catch(() => null);
      const ensured = await ensureUserSandbox(userId, env, store, { signal: request.signal });

      if (body?.files && typeof body.files === 'object') {
        const uploaded = await syncFilesToSandbox(env, ensured.sandboxId, body.files, { signal: request.signal });
        return json(200, { sandboxId: ensured.sandboxId, uploaded });
      }
      if (typeof body?.path === 'string' && typeof body?.content === 'string') {
        const uploaded = await syncFilesToSandbox(env, ensured.sandboxId, { [body.path]: body.content }, { signal: request.signal });
        return json(200, { sandboxId: ensured.sandboxId, uploaded });
      }
      return json(400, { error: 'Provide either { path, content } or { files: { [path]: content } }.' });
    }

    if (pathname === '/api/sandbox/download') {
      if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' });
      const pathParam = searchParams.get('path') || '';
      if (!pathParam.trim()) return json(400, { error: 'A path query parameter is required.' });
      const ensured = await ensureUserSandbox(userId, env, store, { signal: request.signal });
      const downloaded = await downloadSandboxFile(env, ensured.sandboxId, pathParam, { signal: request.signal });
      return json(200, {
        sandboxId: ensured.sandboxId,
        path: downloaded.path,
        content: downloaded.text,
        size: downloaded.size,
      });
    }

    if (pathname === '/api/sandbox/snapshot') {
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
      const snap = await captureUserSandboxSnapshot(userId, env, store, { signal: request.signal });
      return json(200, snap);
    }

    return json(404, { error: 'Not found.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: message });
  }
}
