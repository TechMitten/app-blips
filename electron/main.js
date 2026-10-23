// AppBlips desktop (Electron main process).
//
// The renderer is the desktop build in dist/, served from the privileged
// custom scheme appblips://app. That gives it a stable origin (so UI
// preferences in localStorage persist) and lets the in-process request
// handlers answer /api/* directly: they take a Fetch Request and return a
// Response, which is exactly what protocol.handle expects, so streaming works
// unchanged and nothing listens on a network port.
//
// Projects live on disk (projectStore.js) and the AI provider key in the OS
// keychain (providerStore.js); the renderer reaches both only through the
// narrow IPC surface in preload.cjs.
import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, safeStorage, session, shell } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleChatProxy } from './server/chatProxy.js';
import { SECURITY_HEADERS, MIME_TYPES } from './server/staticFiles.js';
import { describeConfig, formatConfigSummary } from './server/configSummary.js';
import { resolveProvider } from './server/providers.js';
import { createProjectStore, isValidProjectId, writeFileAtomic, PROJECT_FILE } from './projectStore.js';
import { HASH_RE, mimeTypeFor } from '../src/lib/codebase/paths.js';
import { createProviderStore } from './providerStore.js';
import { createSurgeStore } from './surgeStore.js';
import { handleSurgeApi } from './server/surgeApi.js';
import { handlePollinationsApi } from './server/pollinationsApi.js';
import { withSavedProvider } from './server/savedProvider.js';
import { createUpdater } from './updater.js';
import { executeBrowserInput } from './browserControls.js';

const SCHEME = 'appblips';
const APP_ORIGIN = `${SCHEME}://app`;
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const DIST_DIR = join(APP_DIR, 'dist');
const DOCS_URL = 'https://docs.appblips.com';

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
let surgeStore;
let pollinationsStore;
let updater;
// Set once queued project writes are on disk, so the next quit goes ahead.
let flushed = false;

// ---- Settings (projects folder location) -----------------------------------
const settingsFile = () => join(app.getPath('userData'), 'settings.json');
// New installs keep projects in the app's own data folder, where nobody tidying
// Documents deletes them by accident. Updates keep it, but uninstalling or
// resetting the Microsoft Store version deletes it (Windows removes a packaged
// app's AppData), so Settings → Data still offers Export and another folder.
const defaultProjectsRoot = () => join(app.getPath('userData'), 'Projects');
// Where versions before 0.1.9 put them. An install with projects there keeps it.
const legacyProjectsRoot = () => join(app.getPath('documents'), 'AppBlips', 'Projects');

function hasProjects(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .some((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, PROJECT_FILE)));
  } catch {
    return false; // no such folder
  }
}

// Saved once chosen, so the folder never changes under the user later (e.g.
// after they delete every project in the old one).
function resolveProjectsRoot() {
  const saved = readSettings().projectsRoot;
  if (saved) return saved;
  const root = hasProjects(legacyProjectsRoot()) ? legacyProjectsRoot() : defaultProjectsRoot();
  writeSettings({ projectsRoot: root }).catch((err) => console.warn('[main] could not save the projects folder', err));
  return root;
}

function readSettings() {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8')) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[main] ignoring unreadable settings file', settingsFile(), err);
    return {};
  }
}

async function writeSettings(patch) {
  await writeFileAtomic(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2));
}

// ---- Server handlers --------------------------------------------------------
// The one /api/chat handler answers in-process. The desktop app is single-user,
// so the provider saved in Settings → AI travels with each request (see
// withSavedProvider); the env is read for a terminal-launched fallback provider.
// /api/surge/* (Publish) uses the Surge token from surgeStore.js the same way,
// and /api/pollinations/* the Pollinations key.

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
  } catch (err) {
    console.error('[main] could not read app file', filePath, err);
    return new Response('Not found — run `npm run build` first.', { status: 404, headers: SECURITY_HEADERS });
  }
}

// Images, fonts and other files of imported codebases, for the sandboxed
// preview: appblips://assets/<projectId>/<sha256>.<ext>. A separate host, so
// a different origin from appblips://app: even an SVG opened on its own could
// not reach the app's storage, and `CSP: sandbox` gives such a document an
// opaque origin anyway. The preview frame is opaque-origin, so fonts and
// fetch() need ACAO: *. Only content-addressed blobs of a known project id
// can be named; folder names never come from the URL.
const ASSET_PATH_RE = /^\/([A-Za-z0-9_-]{1,128})\/([a-f0-9]{64})(\.[a-z0-9]{1,8})?$/;

async function serveAsset(request, url) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': 'sandbox',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers });
  const match = url.pathname.match(ASSET_PATH_RE);
  if (!match || !isValidProjectId(match[1]) || !HASH_RE.test(match[2])) return new Response('Not found', { status: 404, headers });
  const bytes = await projectStore.readBlob(match[1], match[2]);
  if (!bytes) return new Response('Not found', { status: 404, headers });
  return new Response(request.method === 'HEAD' ? null : bytes, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': mimeTypeFor(`x${match[3] || ''}`),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

async function handleAppRequest(request) {
  const url = new URL(request.url);
  if (url.host === 'assets') {
    try {
      return await serveAsset(request, url);
    } catch (err) {
      console.error('[desktop] asset request failed:', err);
      return new Response('Not found', { status: 404 });
    }
  }
  if (url.host !== 'app') return new Response('Not found', { status: 404 });
  try {
    switch (url.pathname) {
      case '/api/chat':
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        return withSecurityHeaders(await handleChatProxy(await withSavedProvider(request, providerStore), process.env));
      case '/api/surge':
      case '/api/surge/login':
      case '/api/surge/publish':
      case '/api/surge/unpublish':
        return withSecurityHeaders(await handleSurgeApi(request, process.env, surgeStore));
      case '/api/pollinations':
      case '/api/pollinations/login':
      case '/api/pollinations/login/check':
      case '/api/pollinations/image':
        return withSecurityHeaders(await handlePollinationsApi(request, process.env, pollinationsStore));
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
  handle('desktop:browser:input', (args) => executeBrowserInput(mainWindow, args));
  handle('desktop:projects:list', async () => ({
    projects: await projectStore.list(),
    orphanAppData: await projectStore.orphanAppData(),
  }));
  handle('desktop:projects:save', (row) => projectStore.save(row));
  handle('desktop:projects:delete', (id) => projectStore.remove(id));
  handle('desktop:appData:save', (id, map) => projectStore.saveAppData(id, map));
  handle('desktop:blobs:put', (id, entries) => projectStore.putBlobs(id, entries));
  handle('desktop:blobs:get', (id, hashes) => projectStore.getBlobs(id, hashes));

  handle('desktop:provider:get', () => ({ ...providerStore.describe(), envConfigured: envProviderConfigured() }));
  handle('desktop:provider:set', (patch) => providerStore.set(patch));
  handle('desktop:provider:clear', (options) => providerStore.clear({ resetOnboarding: options?.resetOnboarding === true }));
  handle('desktop:provider:models', (input) => providerStore.listModels(input));

  handle('desktop:update:check', () => updater.check());
  // A failed install leaves the app running: take back what beforeInstall gave up.
  handle('desktop:update:install', () => updater.install().catch((err) => {
    flushed = false;
    app.requestSingleInstanceLock();
    throw err;
  }));

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

  handle('desktop:app:quit', () => app.quit());
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
    // mailto: for Publish's "Share by email": it only opens a draft in the
    // user's mail app, which they still have to send.
    if (/^(https?:\/\/|mailto:)/i.test(url)) shell.openExternal(url);
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

// The one exception is the microphone for voice input (Whisper runs locally in
// the renderer): granted only to the app's own top-level page and only for
// audio, so generated code in the preview frame still can't listen, and
// nothing gets the camera.
const isAppPage = (details) => Boolean(
  details?.isMainFrame && details.requestingUrl?.startsWith(`${APP_ORIGIN}/`),
);
const allowMicRequest = (permission, details) => (
  permission === 'media'
  && isAppPage(details)
  && details.mediaTypes?.length > 0
  && details.mediaTypes.every((type) => type === 'audio')
);
const allowMicCheck = (permission, details) => (
  permission === 'media' && isAppPage(details) && details.mediaType === 'audio'
);

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
  // Secret shortcut for the native dev console (Ctrl+Alt+Shift+I). It is kept
  // out of the menu so users don't stumble into DevTools. Matched on `code`, not
  // `key`, because Alt/Shift change the reported key on some keyboard layouts.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.code !== 'KeyI') return;
    if (!input.control || !input.alt || !input.shift) return;
    event.preventDefault();
    mainWindow.webContents.toggleDevTools();
  });
  // Renderer warnings and errors also go to the terminal, so a problem in the
  // desktop app can be reported without opening the hidden DevTools.
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level !== 'warning' && event.level !== 'error') return;
    const where = event.sourceId ? ` (${event.sourceId.replace(APP_ORIGIN, '')}:${event.lineNumber})` : '';
    // Messages from generated code in the preview frame are labelled apart.
    const source = event.frame && event.frame !== mainWindow?.webContents.mainFrame ? 'preview' : 'renderer';
    console[event.level === 'error' ? 'error' : 'warn'](`[${source}] ${event.message}${where}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[main] The window's renderer process stopped: ${details.reason} (exit code ${details.exitCode})`);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, err) => {
    console.error(`[main] Preload script failed (${preloadPath}):`, err);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) console.error(`[main] The app page failed to load: ${description} (${code}) ${url}`);
  });
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
// The monitor variant only observes: Electron's own crash handling still runs.
process.on('uncaughtExceptionMonitor', (err, origin) => console.error(`[main] ${origin}:`, err));
process.on('unhandledRejection', (reason) => console.error('[main] Unhandled promise rejection:', reason));

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('web-contents-created', (_event, contents) => lockDown(contents));

app.whenReady().then(() => {
  projectStore = createProjectStore({
    root: resolveProjectsRoot(),
    orphanDir: join(app.getPath('userData'), 'app-data'),
    trash: (dir) => shell.trashItem(dir),
  });
  providerStore = createProviderStore({
    file: join(app.getPath('userData'), 'provider.json'),
    crypto: safeStorage,
  });
  surgeStore = createSurgeStore({
    file: join(app.getPath('userData'), 'surge.json'),
    crypto: safeStorage,
  });
  pollinationsStore = createSurgeStore({
    file: join(app.getPath('userData'), 'pollinations.json'),
    crypto: safeStorage,
    label: 'Pollinations',
  });

  updater = createUpdater({
    app,
    send: (state) => mainWindow?.webContents.send('desktop:update', state),
    beforeInstall: async () => {
      await projectStore.flush();
      flushed = true;
      // The updated app is started while this one is still quitting; holding
      // the lock would make it see a "second instance" and exit at once.
      app.releaseSingleInstanceLock();
    },
  });

  protocol.handle(SCHEME, handleAppRequest);
  registerIpc();
  buildMenu();

  const allowed = (permission) => ALLOWED_PERMISSIONS.has(permission);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => (
    callback(allowed(permission) || allowMicRequest(permission, details))
  ));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => (
    allowed(permission) || allowMicCheck(permission, details)
  ));

  console.log(`AppBlips desktop ${app.getVersion()} — projects in ${projectStore.root}`);
  console.log(`\n${formatConfigSummary(describeConfig(process.env))}\n`);
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
