import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Search } from 'lucide-react';
import { SettingRow, FIELD_CLASS, SECONDARY_BUTTON } from './SettingControls';
import { isDesktop } from '../lib/desktop';

// Settings → Licenses: AppBlips' own license and credits for the open source
// code it ships. The package list is generated from what each build actually
// bundles (scripts/licenses.js) and loaded only when this tab opens, since
// the full license texts are tens of kilobytes.
const REPO_URL = 'https://github.com/TechMitten/app-blips';

// Loaded from Google Fonts at runtime rather than shipped, so they have no
// license text here, only a credit.
const FONTS = [
  { name: 'Poppins', author: 'Indian Type Foundry', href: 'https://fonts.google.com/specimen/Poppins' },
  { name: 'Plus Jakarta Sans', author: 'Tokotype', href: 'https://fonts.google.com/specimen/Plus+Jakarta+Sans' },
  { name: 'Inter', author: 'Rasmus Andersson', href: 'https://fonts.google.com/specimen/Inter' },
  { name: 'IBM Plex Mono', author: 'IBM', href: 'https://fonts.google.com/specimen/IBM+Plex+Mono' },
];

const LINK_CLASS = 'inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline';

function LicenseText({ text, license }) {
  if (!text) {
    return (
      <p className="text-xs leading-snug text-slate-600">
        This package doesn&rsquo;t include a license file. It is published under the {license} license.
      </p>
    );
  }
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700 custom-scrollbar">
      {text}
    </pre>
  );
}

function LicenseEntry({ name, version, license, author, homepage, text }) {
  return (
    <details className="group py-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="text-sm font-semibold text-slate-900 break-all">{name}</span>
          {version && <span className="ml-1.5 text-xs text-slate-500">{version}</span>}
          {author && <span className="block truncate text-xs text-slate-600">{author}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{license}</span>
          <ChevronDown size={14} className="text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        {homepage && (
          <a href={homepage} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            Project website<ExternalLink size={11} aria-hidden="true" />
          </a>
        )}
        <LicenseText text={text} license={license} />
      </div>
    </details>
  );
}

export default function LicensesSettings() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    import('../lib/thirdPartyLicenses.json')
      .then((module) => { if (!cancelled) setData(module.default); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const needle = query.trim().toLowerCase();
  const packages = (data?.packages || []).filter(({ name, license, author }) => !needle
    || [name, license, author].some((field) => field?.toLowerCase().includes(needle)));

  return (
    <>
      <SettingRow
        id="licenses-appblips"
        title="AppBlips"
        description="AppBlips is open source under the MIT License. You can read, change and share its code."
        details={data && (
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline [&::-webkit-details-marker]:hidden">
              Show license
              <ChevronDown size={12} className="transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-2"><LicenseText text={data.appblips} license="MIT" /></div>
          </details>
        )}
      >
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
          <ExternalLink size={14} />
          Source code
        </a>
      </SettingRow>

      <div className="py-4">
        <h3 className="text-sm font-semibold text-slate-900">Open source packages</h3>
        <p className="mt-0.5 text-xs leading-snug text-slate-600">
          AppBlips is built with {data ? `these ${data.packages.length}` : 'these'} open source projects. Thank you to everyone who makes them. Click one to read its license.
        </p>
        {failed && <p role="alert" className="mt-3 text-xs text-red-600">The license list couldn&rsquo;t be loaded.</p>}
        {!data && !failed && <p className="mt-3 text-xs text-slate-500">Loading&hellip;</p>}
        {data && (
          <>
            <div className="relative mt-3">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search packages"
                aria-label="Search packages"
                className={`${FIELD_CLASS} pl-8`}
              />
            </div>
            <div className="mt-2 divide-y divide-slate-200">
              {packages.map((entry) => <LicenseEntry key={`${entry.name}@${entry.version}`} {...entry} />)}
              {packages.length === 0 && <p className="py-3 text-xs text-slate-500">No packages match &ldquo;{query.trim()}&rdquo;.</p>}
            </div>
          </>
        )}
      </div>

      <div className="py-4 last:pb-0">
        <h3 className="text-sm font-semibold text-slate-900">Other credits</h3>
        <div className="mt-1 divide-y divide-slate-200">
          {(data?.extras || []).map((entry) => <LicenseEntry key={entry.name} {...entry} />)}
          {isDesktop && (
            <div className="py-2.5">
              <p className="text-sm font-semibold text-slate-900">Chromium</p>
              <p className="mt-0.5 text-xs leading-snug text-slate-600">
                The desktop app runs on Electron, which includes Chromium and the open source projects it uses. Their licenses come with the app, in the file LICENSES.chromium.html in the AppBlips install folder.
              </p>
            </div>
          )}
          {/* A service, not shipped code: Publish talks to Surge's API with
              AppBlips' own client (electron/server/surgeApi.js). */}
          <div className="py-2.5">
            <p className="text-sm font-semibold text-slate-900">Surge</p>
            <p className="mt-0.5 text-xs leading-snug text-slate-600">
              Publish puts your sites online with Surge, a hosting service. No Surge code is included in AppBlips. Surge&rsquo;s own terms apply to what you publish.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              <a href="https://surge.sh" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                surge.sh<ExternalLink size={11} aria-hidden="true" />
              </a>
              <a href="https://surge.sh/terms" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                Surge terms<ExternalLink size={11} aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className="py-2.5">
            <p className="text-sm font-semibold text-slate-900">Fonts</p>
            <p className="mt-0.5 text-xs leading-snug text-slate-600">
              The interface uses these fonts from Google Fonts, under the SIL Open Font License 1.1.
            </p>
            <ul className="mt-1.5 space-y-1">
              {FONTS.map(({ name, author, href }) => (
                <li key={name} className="text-xs text-slate-700">
                  <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                    {name}<ExternalLink size={11} aria-hidden="true" />
                  </a>
                  <span className="text-slate-500"> by {author}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
