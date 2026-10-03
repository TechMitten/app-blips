import { useEffect } from 'react';
import {
  ArrowRight, CircleHelp, Gamepad2, LibraryBig, LogIn, LogOut, MonitorSmartphone,
  Play, Settings, Smartphone, X, Zap,
} from 'lucide-react';
import { DOCS_URL } from '../lib/constants';

// Studio choice screen. Two lives:
//   1. Forced gate -- a fresh session with nothing to resume must pick a
//      studio before any workspace exists (no way back, nothing to go back to).
//   2. Mid-session pick -- opened by "New" after the discard confirmation;
//      `onCancel` is set then, so bailing returns to the untouched workspace.
// A deliberately branded, always-dark stage (see studio-choice.css): a
// near-black panel with one stacked list of studios, each tinted with its own
// accent so the otherwise monochrome screen keeps a little colour.

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
    description: 'Multi-page sites that look sharp on every screen, ready to publish.',
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

const NAV_LINK = 'text-sm font-medium text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded-md px-1';

export default function StudioChoice({ onSelectStudio, onCancel = null, savedAppsCount = 0, onOpenProjects, requireSignIn = false, isSignedIn = true, onSignIn, onSignOut, onOpenSettings, onOpenShowcase }) {
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

  // Hosted mode only: self-hosted is a fixed always-signed-in local user.
  const canSignOut = requireSignIn && isSignedIn && !!onSignOut;
  const needsSignIn = requireSignIn && !isSignedIn;

  // Hosted mode keeps projects in the account, so signed-out there is nothing
  // to list -- ask for sign-in instead of opening an empty modal.
  const handleOpenProjects = () => {
    if (needsSignIn) onSignIn?.();
    else onOpenProjects?.();
  };

  return (
    <div className="studio-choice force-dark relative flex-1 min-h-0 overflow-hidden">
      <div className="studio-bg pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative z-1 h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-3 py-3 sm:px-6 sm:py-4">
          {/* Zero-size defs for the logo: alpha = 3*(R+G+B), so the mark's
              opaque black field becomes transparent (see studio-choice.css). */}
          <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
            <filter id="studio-logo-key" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 3 3 0 0" />
            </filter>
          </svg>

          <div className="studio-panel relative flex flex-1 flex-col rounded-[28px] px-4 pb-6 pt-3 sm:px-8 lg:px-14">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Go back"
                title="Go back (Esc)"
                className="studio-close absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:right-4 sm:top-4"
              >
                <X size={22} aria-hidden="true" />
              </button>
            )}

            {/* Top bar: mark left, quick links centred (md+), account right.
                The right padding keeps clear of the close button. */}
            <nav className={`studio-topbar flex shrink-0 items-center gap-3 pb-3 animate-stagger-1 ${onCancel ? 'pr-12 sm:pr-14' : ''}`}>
              <div className="studio-logo-badge mr-auto">
                <img src="/newlog.webp" alt="AppBlips" className="studio-logo-img" />
              </div>

              <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
                {onOpenShowcase && (
                  <button type="button" onClick={onOpenShowcase} className={NAV_LINK}>Showcase</button>
                )}
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
                  className="studio-icon-btn inline-flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 md:hidden"
                >
                  <CircleHelp size={17} aria-hidden="true" />
                </a>
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    aria-label="Settings"
                    title="Settings"
                    className="studio-icon-btn inline-flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <Settings size={17} aria-hidden="true" />
                  </button>
                )}
                {needsSignIn && (
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="studio-outline-btn inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <LogIn size={15} aria-hidden="true" />
                    Sign in
                  </button>
                )}
                {canSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="studio-outline-btn inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <LogOut size={15} aria-hidden="true" />
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                )}
              </div>
            </nav>

            <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center">
              <header className="flex flex-col items-center pt-5 text-center animate-stagger-1 sm:pt-6">
                <span className="studio-badge inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-xs font-medium text-white/80 sm:text-sm">
                  <span className="studio-badge-dot h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                  Describe it. Watch it build.
                </span>

                <h1 className="mt-4 text-[clamp(2rem,7vw,3.75rem)] font-black leading-[1.05] tracking-tight text-white">
                  What will you <span className="studio-heading-accent">build?</span>
                </h1>
                <p className="mt-3 max-w-[58ch] text-sm font-medium leading-relaxed text-white/60 sm:text-base lg:text-lg">
                  Describe what you want in plain English. AppBlips builds a working app,
                  website or game you can preview, refine and publish.
                </p>

                {onOpenShowcase && (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                    <span className="text-sm font-medium text-white/60">Not sure where to start?</span>
                    <button
                      type="button"
                      onClick={onOpenShowcase}
                      className="studio-chip inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    >
                      <Play size={14} aria-hidden="true" />
                      Explore examples
                    </button>
                  </div>
                )}
              </header>

              <div className="mt-6 flex flex-col gap-2.5 animate-stagger-3 sm:mt-7 sm:gap-3">
                {STUDIOS.map(({ key, Icon, title, description, cta }) => {
                  const isProjects = key === 'projects';
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={isProjects ? handleOpenProjects : () => onSelectStudio(key)}
                      aria-label={`${cta}: ${title}`}
                      className={`studio-row studio-row--${key} group flex w-full items-center gap-3 rounded-2xl p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:gap-6 sm:p-3 sm:pr-6`}
                    >
                      <span className="studio-icon-tile relative flex h-16 w-16 shrink-0 items-center justify-center rounded-xl sm:h-20 sm:w-32 sm:rounded-2xl">
                        <Icon className="studio-icon h-8 w-8 sm:h-10 sm:w-10" strokeWidth={1.4} aria-hidden="true" />
                        {isProjects && savedAppsCount > 0 && (
                          <span className="absolute -right-1.5 -top-1.5 inline-flex items-center rounded-full border border-white/15 bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white/80 sm:px-2 sm:text-[11px]">
                            {savedAppsCount} saved
                          </span>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="studio-row-title block text-base font-bold tracking-tight sm:text-xl">{title}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-white/60 sm:mt-1 sm:text-sm">{description}</span>
                      </span>

                      <span className="studio-row-arrow inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12" aria-hidden="true">
                        <ArrowRight size={20} />
                      </span>
                    </button>
                  );
                })}
              </div>

              {needsSignIn && (
                <div className="mt-6 flex flex-col items-center animate-stagger-3">
                  <div className="studio-divider relative flex w-full items-center justify-center" aria-hidden="true">
                    <span className="studio-divider-mark inline-flex h-7 w-7 items-center justify-center rounded-full">
                      <Zap size={13} />
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="studio-primary-btn mt-4 inline-flex items-center gap-2 rounded-2xl px-7 py-3 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    <LogIn size={17} aria-hidden="true" />
                    Sign in to start building
                  </button>
                  <p className="mt-3 text-xs font-medium text-white/50">Your projects are saved to your account.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
