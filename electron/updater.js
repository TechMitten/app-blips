// Desktop updates.
//
// AppImage builds update themselves with electron-updater from the GitHub
// release the Desktop workflow publishes: when the renderer asks for a check
// (it owns the "Check for updates" setting), the update downloads in the
// background, the renderer offers "Restart to update", and an update that was
// never applied installs when the app quits. The win32 branch below only
// matters for a NSIS installer someone builds and publishes themselves — the
// Desktop workflow no longer builds or ships one, since Windows is Microsoft
// Store only now, so a stock win32 install just finds nothing to update.
//
// Other installs can't replace themselves without a password prompt (.deb) or
// aren't installs at all (`npm run desktop`), so check() answers
// { auto: false } and the renderer falls back to its notify-only check
// against the GitHub API (src/lib/updates.js), linking to the release.
//
// Microsoft Store (MSIX) installs are updated by the Store, so they answer
// { auto: false, store: true } and the renderer doesn't check at all.
import electronUpdater from 'electron-updater';

const RECHECK_MS = 60 * 60 * 1000;

export const canAutoUpdate = (app) => app.isPackaged && !process.windowsStore
  && (process.platform === 'win32' || Boolean(process.env.APPIMAGE));

export function createUpdater({ app, send, beforeInstall }) {
  const auto = canAutoUpdate(app);
  // electron-updater builds its platform updater on first access, so it is
  // only touched on installs that update themselves.
  const autoUpdater = auto ? electronUpdater.autoUpdater : null;
  let state = { status: 'idle' }; // idle | downloading | ready
  let lastCheck = 0;

  const report = (next) => {
    state = next;
    send(state);
  };

  if (auto) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('update-available', (info) => report({ status: 'downloading', version: info.version }));
    autoUpdater.on('update-downloaded', (info) => report({ status: 'ready', version: info.version }));
    // A failed check or download is retried at the next check; nothing to show.
    autoUpdater.on('error', (err) => {
      console.warn('[updater]', err);
      if (state.status === 'downloading') state = { status: 'idle' };
    });
  }

  return {
    // Returns { auto, version, state }. Checks at most hourly, and never while
    // an update is downloading or waiting for a restart.
    async check() {
      const result = { auto, version: app.getVersion() };
      if (process.windowsStore) return { ...result, store: true };
      if (!auto) return result;
      const busy = state.status === 'downloading' || state.status === 'ready';
      if (!busy && Date.now() - lastCheck > RECHECK_MS) {
        lastCheck = Date.now();
        autoUpdater.checkForUpdates().catch((err) => console.warn('[updater] check failed:', err));
      }
      return { ...result, state };
    },

    async install() {
      if (state.status !== 'ready') throw new Error('No update is ready to install.');
      await beforeInstall();
      // Silent + relaunch: without isSilent our assisted (non-one-click) NSIS
      // installer opens its full wizard and never starts the app again, so an
      // unfinished wizard left the old version running and offering the same
      // update forever. electron-updater reports a failed start through 'error'
      // (synchronously) and simply doesn't quit, so surface that to the caller.
      let failure = null;
      const onError = (err) => { failure = err; };
      autoUpdater.once('error', onError);
      try {
        autoUpdater.quitAndInstall(true, true);
      } finally {
        autoUpdater.off('error', onError);
      }
      if (failure) throw failure;
    },
  };
}
