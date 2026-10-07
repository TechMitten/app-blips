import { useEffect } from 'react';
import {
  ArrowRight, CircleHelp, Gamepad2, LibraryBig, MonitorSmartphone,
  Settings, Smartphone, X,
} from 'lucide-react';
import { DOCS_URL } from '../lib/constants';

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

export default function StudioChoice({ onSelectStudio, onCancel = null, savedAppsCount = 0, onOpenProjects, onOpenSettings }) {
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
      {/* Zero-size defs for the logo: alpha = 3*(R+G+B), so the mark's
          opaque black field becomes transparent (see studio-choice.css). */}
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <filter id="studio-logo-key" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 3 3 0 0" />
        </filter>
      </svg>

      <div className="relative h-full overflow-y-auto">
        <div className="flex min-h-full flex-col">
          {/* Top bar, like the landing page's: mark left, quick links centred
              (md+), settings on the right. */}
          <nav className="studio-topbar sticky top-0 z-20 shrink-0">
            <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:h-20 sm:px-6 md:px-10">
              <img src="/newlog.webp" alt="AppBlips" className="studio-logo-img mr-auto" />

              <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
                <button type="button" onClick={handleOpenProjects} className={NAV_LINK}>My projects</button>
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={NAV_LINK}>Docs</a>
              </div>

              <div className="flex items-center gap-2">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
