import { useEffect, useState } from 'react';
import { isDesktop, desktopBridge } from '../lib/desktop';
import { checkForUpdate, STORE_URL } from '../lib/updates';
import { safeStorage } from '../lib/config';
import { logWarn } from '../lib/errorLog';

// Settings → Workspace → Check for updates → "Check now". Asks straight away
// (skipping the 12-hour cache and the desktop updater's hourly limit) and
// shows the answer under the row. Works even with the switch off: clicking
// is the user asking for this one check. Mirrors UpdateNotice's three kinds
// of install: self-updating desktop builds report downloading/ready, the
// Microsoft Store links to the Store, everything else links to the release.
// A dismissed notice doesn't hide the answer here, since the user asked.
export function useUpdateCheck() {
  const [result, setResult] = useState(null); // { status, version?, url?, store? }

  // A self-updating build finishes downloading after the check returns.
  useEffect(() => (isDesktop ? desktopBridge.updates.onStatus((state) => {
    if (state?.status === 'ready' || state?.status === 'downloading') setResult({ status: state.status, version: state.version });
  }) : undefined), []);

  const check = async () => {
    setResult({ status: 'checking' });
    try {
      if (isDesktop) {
        const desktop = await desktopBridge.updates.check({ force: true }).catch((err) => {
          logWarn('Desktop update check failed; checking GitHub releases instead', err);
          return null;
        });
        if (desktop?.auto && !desktop.store) {
          const state = desktop.state || {};
          setResult(state.status === 'downloading' || state.status === 'ready'
            ? { status: state.status, version: state.version }
            : { status: 'current' });
          return;
        }
        const release = await checkForUpdate({ storage: safeStorage('local'), force: true });
        setResult(!release ? { status: 'current' }
          : desktop?.store ? { status: 'available', version: release.version, url: STORE_URL, store: true }
            : { status: 'available', ...release });
        return;
      }
      const release = await checkForUpdate({ storage: safeStorage('local'), force: true });
      setResult(release ? { status: 'available', ...release } : { status: 'current' });
    } catch (err) {
      logWarn('Manual update check failed', err);
      setResult({ status: 'failed' });
    }
  };

  return { result, check };
}
