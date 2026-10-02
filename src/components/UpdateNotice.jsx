import { useEffect, useState } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import { supabaseEnabled } from '../supabase';
import { isDesktop, desktopBridge } from '../lib/desktop';
import { checkForUpdate, CHECK_INTERVAL_MS, UPDATE_GUIDE_URL } from '../lib/updates';
import { loadCheckUpdates, loadDismissedUpdate, saveDismissedUpdate, safeStorage } from '../lib/config';

// "A new version is out" notice for self-hosted copies (never on
// appblips.com), behind Settings → Workspace → Check for updates.
//   - Desktop Windows/AppImage builds update themselves (electron/updater.js):
//     the notice appears once the update has downloaded and offers a restart.
//   - Every other self-hosted install (.deb, source, Docker) gets a notice
//     from the GitHub release check (lib/updates.js) with a link: the .deb to
//     download the new installer, source/Docker to the update instructions.
// Closing a release notice hides that version for good; "Later" on a
// downloaded desktop update only hides it until next launch (it installs
// when the app quits anyway).
export default function UpdateNotice() {
  const [update, setUpdate] = useState(null); // { kind: 'notify' | 'ready', version, url? }
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (supabaseEnabled || !loadCheckUpdates()) return undefined;
    let cancelled = false;
    const fromDesktop = (state) => {
      if (!cancelled && state?.status === 'ready') setUpdate({ kind: 'ready', version: state.version });
    };
    const checkReleases = () => checkForUpdate({ storage: safeStorage('local') }).then((release) => {
      if (!cancelled && release && release.version !== loadDismissedUpdate()) setUpdate({ kind: 'notify', ...release });
    });
    const run = async () => {
      if (isDesktop) {
        const result = await desktopBridge.updates.check().catch(() => null);
        if (result?.auto) {
          fromDesktop(result.state);
          return;
        }
      }
      checkReleases();
    };
    const unsubscribe = isDesktop ? desktopBridge.updates.onStatus(fromDesktop) : () => {};
    run();
    const timer = setInterval(run, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  if (!update) return null;

  const dismiss = () => {
    if (update.kind === 'notify') saveDismissedUpdate(update.version);
    setUpdate(null);
  };

  const install = () => {
    setInstalling(true);
    desktopBridge.updates.install().catch(() => setInstalling(false));
  };

  const ready = update.kind === 'ready';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[85] w-[calc(100%-2rem)] max-w-sm rounded-xl border border-slate-200 bg-surface px-4 py-3.5 shadow-xl text-sm text-slate-700"
    >
      <div className="flex items-start gap-3">
        <ArrowUpCircle size={18} className="text-brand shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900">
            {ready ? 'Update ready' : `AppBlips ${update.version} is available`}
          </p>
          <p className="mt-0.5 text-xs text-slate-600 leading-snug">
            {ready
              ? `AppBlips ${update.version} has downloaded. Restart to use it now, or it installs the next time you close AppBlips.`
              : isDesktop
                ? 'Download the new installer and install it over this version. Your projects stay where they are.'
                : 'See what changed, and how to update your copy.'}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {ready ? (
              <>
                <button type="button" onClick={install} disabled={installing} className={PRIMARY_BUTTON}>
                  {installing ? 'Restarting…' : 'Restart to update'}
                </button>
                <button type="button" onClick={dismiss} disabled={installing} className={SECONDARY_BUTTON}>Later</button>
              </>
            ) : (
              <>
                <a href={update.url} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
                  {isDesktop ? 'Download' : "What's new"}
                </a>
                {!isDesktop && (
                  <a href={UPDATE_GUIDE_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
                    How to update
                  </a>
                )}
              </>
            )}
          </div>
        </div>
        {!ready && (
          <button
            type="button"
            onClick={dismiss}
            className="text-slate-400 hover:text-slate-700 p-1 -m-1 rounded-lg transition-colors"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
