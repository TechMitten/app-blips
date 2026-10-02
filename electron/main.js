// AppBlips desktop (Electron main process).
//
// The renderer is the normal self-hosted build in dist/, served from the
// privileged custom scheme appblips://app. That gives it a stable origin
// (so UI preferences in localStorage persist) and lets the same request
// handlers server.js uses answer /api/* in-process: they take a Fetch Request
// and return a Response, which is exactly what protocol.handle expects, so
// streaming works unchanged and nothing listens on a network port.
//
// Projects live on disk (projectStore.js) and the AI provider key in the OS
// keychain (providerStore.js); the renderer reaches both only through the
// narrow IPC surface in preload.cjs.
import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, safeStorage, session, shell } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { handleSelfHostedAiChat } from '../functions/_lib/selfHostedAiRelay.js';
import { handleDebugUnlock } from '../functions/_lib/debugUnlock.js';
import { describeConfig, formatConfigSummary } from '../functions/_lib/configSummary.js';
import { resolveProvider } from '../functions/_lib/providers.js';
import { createProjectStore, isValidProjectId, writeFileAtomic } from './projectStore.js';
import { createProviderStore, providerEnv } from './providerStore.js';
import { createUpdater } from './updater.js';
import { createOAuthLoopback, isSupabaseAuthorizeUrl } from './oauthLoopback.js';

const SCHEME = 'appblips';
const APP_ORIGIN = `${SCHEME}://app`;
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const DIST_DIR = join(APP_DIR, 'dist');
const DOCS_URL = 'https://docs.appblips.com';

// Same headers server.js sends.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

// One instance at a time: two processes writing the same project files would race.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let projectStore;
let providerStore;
let updater;
const oauthLoopback = createOAuthLoopback();
let oauthResult = null;
// Set once queued project writes are on disk, so the next quit goes ahead.
let flushed = false;

// ---- Settings (projects folder location) -----------------------------------
const settingsFile = () => join(app.getPath('userData'), 'settings.json');
const defaultProjectsRoot = () => join(app.getPath('documents'), 'AppBlips', 'Projects');

function readSettings() {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) || {}; } catch { return {}; }
}

async function writeSettings(patch) {
  await writeFileAtomic(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2));
}

// ---- Server handlers --------------------------------------------------------
// Public Supabase URL/publishable key baked in at build time by
// scripts/build-electron.js (Rolldown `define`). Empty for a single-user
// build; the service role key is deliberately not baked (secret).
const BAKED_SUPABASE_URL = __APPBLIPS_SUPABASE_URL__;
const BAKED_SUPABASE_PUBLISHABLE_KEY = __APPBLIPS_SUPABASE_PUBLISHABLE_KEY__;

// Env for the handlers: the provider saved in Settings → AI plus any baked
// Supabase config. Node's URL gives a custom scheme the origin "null", so the
// relay cannot recognise appblips://app as its own origin; it is allow-listed
// instead. The Open in new tab shell (a blob: window opened from the app)
// shares that origin and calls the relay for its sandboxed app.
function handlerEnv() {
  const base = {
    ...process.env,
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || BAKED_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || BAKED_SUPABASE_PUBLISHABLE_KEY,
    APPBLIPS_GENERATED_AI_MODE: 'relay',
    APPBLIPS_APP_AI_ALLOWED_ORIGINS: [process.env.APPBLIPS_APP_AI_ALLOWED_ORIGINS, APP_ORIGIN].filter(Boolean).join(','),
  };
  return providerEnv(base, providerStore.active());
}

// The builder sends no key: the saved one is attached here, as the same
// `user_provider` the web build sends from the browser, so chatProxy applies
// identical handling (preset endpoint, "rejected the API key" errors). A test
// request for the saved provider may leave apiKey empty to mean "the saved key".
async function withSavedProvider(request) {
  if (request.method !== 'POST') return request;
  const text = await request.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const sent = body.user_provider;
    if (sent && typeof sent === 'object' && !sent.apiKey) {
      body.user_provider = { ...sent, apiKey: providerStore.keyFor(sent.id) };
    } else if (sent == null) {
      const active = providerStore.active();
      if (active) body.user_provider = active;
    }
  }
  const origin = request.headers.get('origin');
  const authorization = request.headers.get('authorization');
  return new Request(request.url, {
    method: 'POST',
    // Origin is kept for chatProxy's other-site check: a sandboxed app's
    // request arrives as Origin "null" and must still be refused. The Supabase
    // bearer token is forwarded so a multi-user build verifies sign-in.
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
      ...(authorization ? { authorization } : {}),
    },
    body: body ? JSON.stringify(body) : text,
  });
}

const withSecurityHeaders = (response) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

async function serveStatic(pathname) {
  const requested = decodeURIComponent(pathname);
  const safePath = normalize(join(DIST_DIR, requested));
  if (!safePath.startsWith(DIST_DIR + sep) && safePath !== DIST_DIR) {
    return new Response('Bad request', { status: 400, headers: SECURITY_HEADERS });
  }
  const indexFile = join(DIST_DIR, 'index.html');
  let filePath = requested === '/' ? indexFile : safePath;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    await stat(filePath);
  } catch {
    filePath = indexFile; // SPA fallback
  }
  try {
    const body = await readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
        'Cache-Control': filePath === indexFile ? 'no-cache' : 'public, max-age=3600',
      },
    });
  } catch {
    return new Response('Not found — run `npm run build` first.', { status: 404, headers: SECURITY_HEADERS });
  }
}

async function handleAppRequest(request) {
  const url = new URL(request.url);
  if (url.host !== 'app') return new Response('Not found', { status: 404 });
  try {
    switch (url.pathname) {
      case '/api/chat':
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        return withSecurityHeaders(await handleChatProxy(await withSavedProvider(request), handlerEnv()));
      case '/api/app-ai/chat':
        return withSecurityHeaders(await handleSelfHostedAiChat(request, handlerEnv()));
      case '/api/debug-unlock':
        return withSecurityHeaders(await handleDebugUnlock(request, handlerEnv()));
      default:
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return new Response('Method not allowed', { status: 405, headers: SECURITY_HEADERS });
        }
        return await serveStatic(url.pathname);
    }
  } catch (err) {
    console.error('[desktop] request failed:', url.pathname, err);
    return new Response(JSON.stringify({ error: 'Internal error.' }), {
      status: 500,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

// ---- IPC ---------------------------------------------------------------------
// Only the app's own top-level page may call these: not a blob: window opened
// with generated code, and not the sandboxed preview iframe.
const fromApp = (event) => {
  const frame = event.senderFrame;
  return Boolean(frame && frame.parent === null && frame.url.startsWith(`${APP_ORIGIN}/`));
};

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromApp(event)) throw new Error('Not allowed.');
    return fn(...args);
  });
}

// Whether any provider is usable without Settings → AI (env vars set by a
// power user launching from a terminal).
const envProviderConfigured = () => !resolveProvider(process.env, 'APPBLIPS_LLM', { quiet: true }).error;

function registerIpc() {
  handle('desktop:projects:list', async () => ({
    projects: await projectStore.list(),
    orphanAppData: await projectStore.orphanAppData(),
  }));
  handle('desktop:projects:save', (row) => projectStore.save(row));
  handle('desktop:projects:delete', (id) => projectStore.remove(id));
  handle('desktop:appData:save', (id, map) => projectStore.saveAppData(id, map));

  handle('desktop:provider:get', () => ({ ...providerStore.describe(), envConfigured: envProviderConfigured() }));
  handle('desktop:provider:set', (patch) => providerStore.set(patch));
  handle('desktop:provider:clear', () => providerStore.clear());

  // Sign-in with Google/GitHub in the system browser. `begin` opens the
  // loopback listener and returns the redirect URI to register with Supabase;
  // `open` sends the browser to the authorize URL Supabase produced for it and
  // resolves with the code from the redirect. The renderer exchanges the code
  // (PKCE), so no token passes through here.
  handle('desktop:auth:begin', async () => {
    const { redirectUri, result } = await oauthLoopback.begin();
    oauthResult = result;
    return { redirectUri };
  });
  handle('desktop:auth:open', async (url) => {
    const supabaseUrl = handlerEnv().SUPABASE_URL;
    if (!oauthResult || !supabaseUrl || !isSupabaseAuthorizeUrl(url, supabaseUrl)) {
      throw new Error('Sign-in could not be started.');
    }
    const result = oauthResult;
    await shell.openExternal(url);
    return result;
  });
  handle('desktop:auth:cancel', () => oauthLoopback.cancel());

  handle('desktop:update:check', () => updater.check());
  handle('desktop:update:install', () => updater.install());

  handle('desktop:folder:get', () => projectStore.root);
  handle('desktop:folder:open', async (id) => {
    const target = id && isValidProjectId(id) ? projectStore.folderOf(id) : null;
    const error = await shell.openPath(target || projectStore.root);
    if (error) throw new Error(error);
  });
  // Returns { changed, root, moved }. The renderer reloads after a change, so
  // its in-memory copy is rebuilt from the new folder.
  handle('desktop:folder:choose', async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for your AppBlips projects',
      defaultPath: projectStore.root,
      properties: ['openDirectory', 'createDirectory'],
    });
    const target = picked.filePaths?.[0];
    if (picked.canceled || !target || normalize(target) === projectStore.root) {
      return { changed: false, root: projectStore.root, moved: 0 };
    }
    // Moving projects into a folder inside the current one could move a
    // project folder into itself.
    if (normalize(target).startsWith(projectStore.root + sep)) {
      throw new Error('Choose a folder outside the current projects folder');
    }
    let move = false;
    const count = await projectStore.count();
    if (count > 0) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Move projects', 'Leave them where they are', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: `Move your ${count} ${count === 1 ? 'project' : 'projects'} to the new folder?`,
        detail: 'Projects left in the old folder will no longer appear in AppBlips until you switch back.',
      });
      if (response === 2) return { changed: false, root: projectStore.root, moved: 0 };
      move = response === 0;
    }
    const moved = await projectStore.changeRoot(target, { move });
    await writeSettings({ projectsRoot: projectStore.root });
    return { changed: true, root: projectStore.root, moved };
  });
}

// ---- Windows & navigation -------------------------------------------------------
const isAppUrl = (url) => url === APP_ORIGIN || url.startsWith(`${APP_ORIGIN}/`);

// Applied to every web contents: the main window and the blob: window of an
// Open in new tab shell. A sandboxed app can only create blob:null URLs, so it
// cannot open a window of its own this way.
function lockDown(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`blob:${APP_ORIGIN}/`)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url) && isAppUrl(contents.getURL())) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

// Generated apps can't ask for camera/mic/location/etc. without a prompt in a
// browser; Electron grants everything by default, so only allow harmless ones.
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock']);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#080808',
    title: 'AppBlips',
    icon: join(APP_DIR, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(APP_DIR, 'electron', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(`${APP_ORIGIN}/`);
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Projects Folder', click: () => shell.openPath(projectStore.root) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal(DOCS_URL) },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Lifecycle -------------------------------------------------------------------
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('web-contents-created', (_event, contents) => lockDown(contents));

app.whenReady().then(() => {
  projectStore = createProjectStore({
    root: readSettings().projectsRoot || defaultProjectsRoot(),
    orphanDir: join(app.getPath('userData'), 'app-data'),
    trash: (dir) => shell.trashItem(dir),
  });
  providerStore = createProviderStore({
    file: join(app.getPath('userData'), 'provider.json'),
    crypto: safeStorage,
  });

  updater = createUpdater({
    app,
    send: (state) => mainWindow?.webContents.send('desktop:update', state),
    beforeInstall: async () => {
      await projectStore.flush();
      flushed = true;
    },
  });

  protocol.handle(SCHEME, handleAppRequest);
  registerIpc();
  buildMenu();

  const allowed = (permission) => ALLOWED_PERMISSIONS.has(permission);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));

  console.log(`AppBlips desktop ${app.getVersion()} — projects in ${projectStore.root}`);
  console.log(`\n${formatConfigSummary(describeConfig(handlerEnv()))}\n`);
  createWindow();
});

app.on('window-all-closed', () => app.quit());

// Let queued project writes finish before the process exits.
app.on('before-quit', (event) => {
  if (flushed || !projectStore) return;
  event.preventDefault();
  projectStore.flush().finally(() => {
    flushed = true;
    app.quit();
  });
});
