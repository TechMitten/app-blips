import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { SECONDARY_BUTTON } from './SettingControls';
import { debUpdateCommand, DESKTOP_UPDATE_GUIDE_URL } from '../lib/updates';

// How to update a .deb install, shared by the update notice and Settings →
// Check now. The app can't install a .deb itself (that needs the user's
// password), so this spells out the steps: with the AppBlips apt source
// (electron/debInstall.js) the software center or `apt upgrade` does it;
// without it, download the new .deb and install it. `Link` is how each caller
// opens external pages (Settings confirms first, the notice doesn't).
export default function DebUpdateHelp({ update, Link }) {
  const [copied, setCopied] = useState(false);
  const command = debUpdateCommand(update);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the command is still on screen to select */ }
  };

  return (
    <div className="text-xs text-slate-600 leading-snug">
      <p>
        {update.apt
          ? 'Install it from the Updates section of your software center, or run this in a terminal:'
          : 'Click Download, then open the downloaded file to install it with your software center. Or, once it has downloaded, run this in a terminal:'}
      </p>
      <div className="mt-1.5 flex items-start gap-2">
        <code className="flex-1 min-w-0 rounded-md border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-800 break-all select-all">
          {command}
        </code>
        <button type="button" onClick={copy} className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors" aria-label={copied ? 'Copied' : 'Copy command'} title={copied ? 'Copied' : 'Copy command'}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
      </div>
      <p className="mt-1.5">
        {update.apt
          ? 'Not offered yet? It can take a little while to reach apt; you can download the installer instead. '
          : 'If your browser saved it somewhere other than Downloads, change the folder in the command. '}
        Your projects stay where they are.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {(update.downloadUrl || update.url) && (
          <Link href={update.downloadUrl || update.url} why="To download the newer version of AppBlips from the AppBlips release page." className={SECONDARY_BUTTON}>
            {update.apt ? 'Download installer' : 'Download'}
          </Link>
        )}
        <Link href={DESKTOP_UPDATE_GUIDE_URL} why="To read step-by-step instructions for updating AppBlips." className={SECONDARY_BUTTON}>
          How to update
        </Link>
      </div>
    </div>
  );
}
