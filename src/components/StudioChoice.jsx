import { useEffect } from 'react';
import {
  ArrowRight, CircleHelp, FolderUp, Gamepad2, Github, LibraryBig, MonitorSmartphone,
  Settings, Smartphone, X,
} from 'lucide-react';
import { DOCS_URL, GITHUB_URL, DISCORD_URL } from '../lib/constants';

// Lucide has no Discord mark, so this is the brand's own glyph (official
// invite/widget assets), drawn to match the lucide icons' ~17px box.
function DiscordIcon({ size = 17, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.075.035c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036 19.74 19.74 0 0 0-4.885 1.516.07.07 0 0 0-.032.027C.533 9.045-.32 13.579.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.073.073 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.041.107c.36.698.772 1.364 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.673-3.549-13.66a.061.061 0 0 0-.031-.028M8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.955 2.419-2.157 2.419m7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.946 2.419-2.157 2.419" />
    </svg>
  );
}

// Studio choice screen. Two lives:
//   1. Forced gate -- a fresh session with nothing to resume must pick a
//      studio before any workspace exists (no way back, nothing to go back to).
//   2. Mid-session pick -- opened by "New" after the discard confirmation;
//      `onCancel` is set then, so bailing returns to the untouched workspace.
// Styled to match the appblips.com landing page (see studio-choice.css): a
// monochrome stage with a top bar, a centred hero and light glass cards, so
// stepping from the marketing site into the studio feels like the same
// product. It follows the app theme: dark is the landing page's look, light
// is its mirror image.

const STUDIOS = [
  {
    key: 'app',
    Icon: Smartphone,
    title: 'Mobile & Web App',
    description: 'Interactive tools, dashboards and utilities that work on any device.',
    cta: 'Build an app',
  },
  {
    key: 'website',
    Icon: MonitorSmartphone,
    title: 'Responsive Website',
    description: 'Multi-page sites that look sharp on every screen, ready to share.',
    cta: 'Build a website',
  },
  {
    key: 'game',
    Icon: Gamepad2,
    title: 'Browser Game',
    description: '2D and 3D games with touch and keyboard controls that run in the browser.',
    cta: 'Build a game',
  },
  {
    key: 'projects',
    Icon: LibraryBig,
    title: 'Quick Start & Library',
    description: 'Pick up where you left off, or start from a ready-made template.',
    cta: 'Browse templates',
  },
];

// Colours come from the studio-* classes (studio-choice.css), not Tailwind's
// white/black utilities, so each one has a dark and a light value.
const FOCUS_RING = 'studio-focus';
const NAV_LINK = `studio-nav-link rounded-md px-1 text-sm font-medium ${FOCUS_RING}`;
const GHOST_BTN = `studio-ghost-btn inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium ${FOCUS_RING}`;

export default function StudioChoice({ onSelectStudio, onCancel = null, savedAppsCount = 0, onOpenProjects, onOpenSettings, onImportSite = null }) {
  // Escape mirrors the on-screen close control, but only when there is
  // something to go back to (the forced gate has none). A modal open over the
  // picker (e.g. Settings) handles its own Escape first.
  useEffect(() => {
    if (!onCancel) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const handleOpenProjects = () => {
    onOpenProjects?.();
  };

  return (
    <div className="studio-choice relative flex-1 min-h-0 overflow-hidden">
      {/* Zero-size defs for the logo: alpha = 2.5*(R+G+B) - 1.2, so the mark's
          opaque dark field becomes transparent (see studio-choice.css). */}
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <filter id="studio-logo-key" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  2.5 2.5 2.5 0 -1.2" />
        </filter>
      </svg>

      <div className="relative h-full overflow-y-auto">
        <div className="flex min-h-full flex-col">
          {/* Top bar, like the landing page's: mark left, quick links centred
              (md+), GitHub and settings on the right. */}
          <nav className="studio-topbar sticky top-0 z-20 shrink-0">
            <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:h-20 sm:px-6 md:px-10">
              <img src="/blackblipsbg.webp" alt="AppBlips" className="studio-logo-img mr-auto" />

              <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
                <button type="button" onClick={handleOpenProjects} className={NAV_LINK}>My projects</button>
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={NAV_LINK}>Docs</a>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="AppBlips on GitHub"
                  title="AppBlips on GitHub"
                  className={`${GHOST_BTN} h-9 w-9`}
                >
                  <Github size={17} aria-hidden="true" />
                </a>
                <a
                  href={DISCORD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Join the AppBlips Discord"
                  title="Join the AppBlips Discord"
                  className={`${GHOST_BTN} h-9 w-9`}
                >
                  <DiscordIcon size={17} />
                </a>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Help and documentation"
                  title="Help and documentation"
                  className={`${GHOST_BTN} h-9 w-9 md:hidden`}
                >
                  <CircleHelp size={17} aria-hidden="true" />
                </a>
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    aria-label="Settings"
                    title="Settings"
                    className={`${GHOST_BTN} h-9 w-9`}
                  >
                    <Settings size={17} aria-hidden="true" />
                  </button>
                )}
                {onCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    aria-label="Go back"
                    title="Go back (Esc)"
                    className={`${GHOST_BTN} h-9 w-9`}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </nav>

          <div className="relative flex flex-1 flex-col">
            <div className="studio-glow pointer-events-none absolute inset-0" aria-hidden="true" />
            <div className="studio-dots pointer-events-none absolute inset-0" aria-hidden="true" />

            <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-10 sm:px-6 sm:py-14 md:px-10">
              <header className="flex flex-col items-center text-center animate-stagger-1">
                <span className="studio-pill inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium">
                  <span className="studio-eyebrow-dot h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                  Describe it. Watch it build.
                </span>

                <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight studio-text-strong sm:mt-6 sm:text-5xl md:text-6xl">
                  What will you build?
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-snug studio-text-muted sm:mt-5 sm:text-lg">
                  Describe what you want in plain English. AppBlips builds a working app,
                  website or game you can preview and refine.
                </p>

              </header>

              <div className="mt-10 grid grid-cols-1 gap-4 animate-stagger-3 sm:mt-12 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
                {STUDIOS.map(({ key, Icon, title, description, cta }) => {
                  const isProjects = key === 'projects';
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={isProjects ? handleOpenProjects : () => onSelectStudio(key)}
                      aria-label={`${cta}: ${title}`}
                      className={`studio-card group flex items-start gap-4 rounded-2xl p-5 text-left sm:flex-col sm:gap-0 sm:p-6 ${FOCUS_RING}`}
                    >
                      <span className="studio-icon-tile relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:mb-5 sm:h-12 sm:w-12">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                        {isProjects && savedAppsCount > 0 && (
                          <span className="studio-saved-badge absolute -right-2 -top-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                            {savedAppsCount} saved
                          </span>
                        )}
                      </span>

                      <span className="flex min-w-0 flex-1 flex-col self-stretch">
                        <span className="block text-base font-semibold studio-text-strong sm:text-lg">{title}</span>
                        <span className="mt-1.5 block text-sm leading-relaxed studio-text-soft">{description}</span>
                        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold studio-text-strong sm:mt-auto sm:pt-6" aria-hidden="true">
                          {cta}
                          <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Importing an existing React + Vite project is the less common
                  path, so it sits under the studios as one wide row. */}
              {onImportSite && (
                <button
                  type="button"
                  onClick={onImportSite}
                  aria-label="Import a site: open a React + Vite project from a .zip"
                  className={`studio-card group mt-4 flex items-center gap-4 rounded-2xl p-4 text-left animate-stagger-3 sm:mt-5 sm:px-6 ${FOCUS_RING}`}
                >
                  <span className="studio-icon-tile flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                    <FolderUp className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="block text-base font-semibold studio-text-strong">Import a site</span>
                    <span className="mt-0.5 block text-sm leading-relaxed studio-text-soft">
                      Got a React + Vite project from your web designer? Open its .zip and keep editing it with AI.
                    </span>
                  </span>
                  <span className="hidden items-center gap-1.5 text-sm font-semibold studio-text-strong sm:inline-flex" aria-hidden="true">
                    Import .zip
                    <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
                  </span>
                </button>
              )}
            </div>
          </div>

          <footer className="studio-footer relative shrink-0">
            <nav aria-label="Footer links" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 whitespace-nowrap px-4 py-3 sm:gap-x-6 sm:py-4 sm:px-6 md:px-10">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="AppBlips on GitHub"
                title="AppBlips on GitHub"
                className={`${NAV_LINK} inline-flex min-h-9 items-center gap-2`}
              >
                <Github size={17} aria-hidden="true" />
                <span>GitHub</span>
              </a>
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Join the AppBlips Discord"
                title="Join the AppBlips Discord"
                className={`${NAV_LINK} inline-flex min-h-9 items-center gap-2`}
              >
                <DiscordIcon size={17} />
                <span>Discord</span>
              </a>
              <a
                href="https://www.appblips.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className={`${NAV_LINK} inline-flex min-h-9 items-center`}
              >
                Privacy Policy
              </a>
              <a
                href="https://www.appblips.com/terms"
                target="_blank"
                rel="noopener noreferrer"
                className={`${NAV_LINK} inline-flex min-h-9 items-center`}
              >
                Terms of Service
              </a>
            </nav>
          </footer>
        </div>
      </div>
    </div>
  );
}
