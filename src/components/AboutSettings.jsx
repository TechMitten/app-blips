import { Bug, ExternalLink } from 'lucide-react';
import { ConfirmedLink } from './ExternalLinkConfirm';
import { SECONDARY_BUTTON, SettingRow } from './SettingControls';
import LicensesSettings from './LicensesSettings';
import { isDesktop } from '../lib/desktop';
import { CURRENT_VERSION } from '../lib/updates';

// Settings → About: logo, version and copyright, then the legal links and the
// open source licenses (once tabs of their own). The copyright line mirrors
// LICENSE; keep the two in sync.
const COPYRIGHT = '© 2026 TechMitten LLC';
const WEBSITE_URL = 'https://www.appblips.com';
const REPO_URL = 'https://github.com/TechMitten/app-blips';
const BUG_REPORT_URL = `${REPO_URL}/issues/new`;
const LEGAL_LINKS = [
  { id: 'legal-privacy', title: 'Privacy Policy', description: 'How AppBlips collects, uses and protects your data.', why: 'The Privacy Policy is published on the AppBlips website, not inside the app.', href: 'https://www.appblips.com/privacy' },
  { id: 'legal-terms', title: 'Terms of Service', description: 'The terms that apply when you use AppBlips.', why: 'The Terms of Service are published on the AppBlips website, not inside the app.', href: 'https://www.appblips.com/terms' },
  // A service, not shipped code (Publish talks to Surge's API with AppBlips'
  // own client, electron/server/surgeApi.js), so its terms go here, not under
  // Licenses.
  { id: 'legal-surge', title: 'Surge Terms of Service', description: 'Publish puts your sites online with Surge, a hosting service. Surge\u2019s own terms apply to what you publish. No Surge code is included in AppBlips.', why: 'Surge\u2019s own terms apply to what you publish, and they are hosted by Surge.', href: 'https://surge.sh/terms' },
  // Also a service: plans are paid through Polar's checkout (the server's own
  // client, electron/server/hosted/polar.js), so no Polar code ships either.
  { id: 'legal-polar', title: 'Polar Checkout Buyer Terms', description: 'AppBlips plans are paid through Polar, which sells them as the merchant of record. Polar\u2019s buyer terms apply to your payments, refunds and subscription. No Polar code is included in AppBlips.', why: 'Polar\u2019s own terms apply to plan payments, and they are hosted by Polar.', href: 'https://polar.sh/legal/checkout-buyer-terms' },
];
// h3: the dialog's own title is the h2. scroll-mt keeps a heading clear of the panel's top edge after a jump.
const SECTION_CLASS = 'mt-8 mb-1 scroll-mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 focus:outline-none';
const SECTIONS = [
  { id: 'about-legal', label: 'Legal' },
  { id: 'about-licenses', label: 'Licenses' },
];

// The links scroll the Settings panel itself rather than following the
// #hash, which would change the app's own URL. Focus moves to the heading so
// keyboard and screen reader users land there too.
function jumpTo(event, id) {
  event.preventDefault();
  const heading = document.getElementById(id);
  if (!heading) return;
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no matchMedia */ }
  heading.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  heading.focus({ preventScroll: true });
}

export default function AboutSettings() {
  return (
    <>
    <div className="flex flex-col items-center py-6 text-center">
      <img src="/favicon.svg" alt="" aria-hidden="true" className="h-16 w-16" />
      {/* Two wordmarks, one visible per theme (as on the studio picker). */}
      <img src="/appblips-wordmark-dark.svg" alt="AppBlips" className="mt-4 hidden h-auto w-40 dark:block" />
      <img src="/appblips-wordmark-light.svg" alt="AppBlips" className="mt-4 block h-auto w-40 dark:hidden" />
      <p className="mt-3 text-sm font-semibold text-slate-700">
        Version {CURRENT_VERSION}
        <span className="font-normal text-slate-500"> · {isDesktop ? 'Desktop app' : 'Browser version'}</span>
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <ConfirmedLink href={WEBSITE_URL} why="To visit the AppBlips website for news, pricing and help." className={SECONDARY_BUTTON}>
          <ExternalLink size={14} aria-hidden="true" />
          Website
        </ConfirmedLink>
        <ConfirmedLink href={REPO_URL} why="To show you AppBlips&rsquo;s source code, which is public on GitHub." className={SECONDARY_BUTTON}>
          <ExternalLink size={14} aria-hidden="true" />
          Source code
        </ConfirmedLink>
        <ConfirmedLink href={BUG_REPORT_URL} why="Bug reports are filed on GitHub, so you need to describe the problem on that page." className={SECONDARY_BUTTON}>
          <Bug size={14} aria-hidden="true" />
          Report a bug
        </ConfirmedLink>
      </div>
      <nav aria-label="About sections" className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
        {SECTIONS.map(({ id, label }) => (
          <a key={id} href={`#${id}`} onClick={(e) => jumpTo(e, id)} className="font-semibold text-indigo-600 hover:underline">
            {label}
          </a>
        ))}
      </nav>
      <p className="mt-6 text-xs text-slate-500">
        {COPYRIGHT}
        <br />
        Open source under the MIT License.
      </p>
    </div>

    <h3 id="about-legal" tabIndex={-1} className={SECTION_CLASS}>Legal</h3>
    {LEGAL_LINKS.map(({ id, title, description, href, why }) => (
      <SettingRow key={id} id={id} title={title} description={description} headingLevel={4}>
        <ConfirmedLink href={href} why={why} className={SECONDARY_BUTTON}>
          <ExternalLink size={14} aria-hidden="true" />
          View
        </ConfirmedLink>
      </SettingRow>
    ))}

    <h3 id="about-licenses" tabIndex={-1} className={SECTION_CLASS}>Licenses</h3>
    <LicensesSettings />
    </>
  );
}
