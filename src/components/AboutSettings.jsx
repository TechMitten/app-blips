import { Bug, ExternalLink } from 'lucide-react';
import { SECONDARY_BUTTON } from './SettingControls';
import { isDesktop } from '../lib/desktop';
import { CURRENT_VERSION } from '../lib/updates';

// Settings → About: logo, version and copyright. The copyright line mirrors
// LICENSE; keep the two in sync.
const COPYRIGHT = '© 2026 Tech Mitten LLC';
const WEBSITE_URL = 'https://www.appblips.com';
const REPO_URL = 'https://github.com/TechMitten/app-blips';
const BUG_REPORT_URL = `${REPO_URL}/issues/new`;

export default function AboutSettings() {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <img src="/favicon.svg" alt="" aria-hidden="true" className="h-16 w-16" />
      {/* Two wordmarks, one visible per theme (as on the studio picker). */}
      <img src="/appblips-wordmark-dark.svg" alt="AppBlips" className="mt-4 hidden h-auto w-40 dark:block" />
      <img src="/appblips-wordmark-light.svg" alt="AppBlips" className="mt-4 block h-auto w-40 dark:hidden" />
      <p className="mt-3 text-sm font-semibold text-slate-700">
        Version {CURRENT_VERSION}
        <span className="font-normal text-slate-500"> · {isDesktop ? 'Desktop app' : 'Browser version'}</span>
      </p>
      <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">
        Turn a plain-English prompt into a working app, website or game.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <a href={WEBSITE_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
          <ExternalLink size={14} aria-hidden="true" />
          Website
        </a>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
          <ExternalLink size={14} aria-hidden="true" />
          Source code
        </a>
        <a href={BUG_REPORT_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
          <Bug size={14} aria-hidden="true" />
          Report a bug
        </a>
      </div>
      <p className="mt-6 text-xs text-slate-500">
        {COPYRIGHT}
        <br />
        Open source under the MIT License.
      </p>
    </div>
  );
}
