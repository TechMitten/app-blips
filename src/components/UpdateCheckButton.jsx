import { ConfirmedLink } from './ExternalLinkConfirm';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SECONDARY_BUTTON } from './SettingControls';
import { isDesktop, desktopBridge } from '../lib/desktop';
import { UPDATE_GUIDE_URL } from '../lib/updates';
import { logError } from '../lib/errorLog';

// The "Check now" button and its answer for Settings → Workspace → Check for
// updates. The check itself lives in hooks/useUpdateCheck.js.
export function UpdateCheckButton({ checking, onCheck }) {
  return (
    <button type="button" onClick={onCheck} disabled={checking} className={SECONDARY_BUTTON}>
      <RefreshCw size={14} aria-hidden="true" className={checking ? 'animate-spin' : ''} />
      {checking ? 'Checking…' : 'Check now'}
    </button>
  );
}

export function UpdateCheckResult({ result }) {
  const [installing, setInstalling] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  if (!result || result.status === 'checking') return null;

  const install = () => {
    setInstalling(true);
    setInstallFailed(false);
    desktopBridge.updates.install().catch((err) => {
      logError('Could not install the downloaded update', err);
      setInstalling(false);
      setInstallFailed(true);
    });
  };

  const text = {
    current: "You're up to date.",
    failed: "Couldn't reach GitHub to check. Check your internet connection and try again.",
    downloading: `AppBlips ${result.version} is downloading in the background. You'll be offered a restart when it's ready.`,
    ready: `AppBlips ${result.version} has downloaded. Restart to use it now, or it installs the next time you close AppBlips.`,
    available: result.store
      ? `AppBlips ${result.version} is available. Open the Microsoft Store to update; it can take a day or two to appear there.`
      : `AppBlips ${result.version} is available.`,
  }[result.status];

  return (
    <div role="status" aria-live="polite" className="text-xs leading-snug">
      <p className={result.status === 'failed' ? 'text-red-600' : 'text-slate-600'}>{text}</p>
      {installFailed && (
        <p className="mt-1.5 text-red-600">
          The update couldn't start. Close AppBlips to install it, or download the new installer from the releases page.
        </p>
      )}
      {result.status === 'ready' && (
        <div className="mt-2">
          <button type="button" onClick={install} disabled={installing} className={SECONDARY_BUTTON}>
            {installing ? 'Restarting…' : 'Restart to update'}
          </button>
        </div>
      )}
      {result.status === 'available' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <ConfirmedLink href={result.url} why={result.store ? 'To get the update from the Microsoft Store.' : isDesktop ? 'To download the newer version of AppBlips from the AppBlips release page.' : 'To read what changed in the newest version of AppBlips.'} className={SECONDARY_BUTTON}>
            {result.store ? 'Open Microsoft Store' : isDesktop ? 'Download' : "What's new"}
          </ConfirmedLink>
          {!isDesktop && (
            <ConfirmedLink href={UPDATE_GUIDE_URL} why="To read step-by-step instructions for updating the browser version." className={SECONDARY_BUTTON}>
              How to update
            </ConfirmedLink>
          )}
        </div>
      )}
    </div>
  );
}
