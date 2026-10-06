import { useEffect } from 'react';
import {
  ArrowRight, CircleHelp, Gamepad2, LibraryBig, LogIn, LogOut, MonitorSmartphone,
  Play, Settings, Smartphone, Sparkles, X,
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

// Colours come from the studio-* classes (studio-choice.css), not Tailwind's
// white/black utilities, so each one has a dark and a light value.
const FOCUS_RING = 'studio-focus';
const NAV_LINK = `studio-nav-link rounded-md px-1 text-sm font-medium ${FOCUS_RING}`;
const GHOST_BTN = `studio-ghost-btn inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium ${FOCUS_RING}`;

export default function StudioChoice({ onSelectStudio, onCancel = null, savedAppsCount = 0, onOpenProjects, requireSignIn = false, isSignedIn = true, onSignIn, onSignOut, onOpenSettings, onOpenShowcase, billingPlan = null, billingTrialing = false, onOpenPlans }) {
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
              (md+), account actions right. */}
          <nav className="studio-topbar sticky top-0 z-20 shrink-0">
            <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:h-20 sm:px-6 md:px-10">
              <img src="/newlog.webp" alt="AppBlips" className="studio-logo-img mr-auto" />

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
                  className={`${GHOST_BTN} h-9 w-9 md:hidden`}
                >
                  <CircleHelp size={17} aria-hidden="true" />
                </a>
                {/* Only when this instance bills (billingPlan is null otherwise). */}
                {billingPlan && onOpenPlans && (
                  <button
                    type="button"
                    onClick={onOpenPlans}
                    title={billingPlan === 'none' ? 'See plans' : 'Your plan and usage'}
                    className={`${GHOST_BTN} h-9 px-3.5`}
                  >
                    <Sparkles size={15} aria-hidden="true" />
                    <span>{billingPlan === 'none' ? 'Start free trial' : billingPlan === 'plus' ? (billingTrialing ? 'Free trial' : 'Plus') : 'Pro'}</span>
                  </button>
                )}
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
                {needsSignIn && (
                  <button
                    type="button"
                    onClick={onSignIn}
                    className={`studio-primary-btn inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${FOCUS_RING}`}
                  >
                    <LogIn size={15} aria-hidden="true" />
                    Sign in
                  </button>
                )}
                {canSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className={`${GHOST_BTN} h-9 px-3.5`}
                  >
                    <LogOut size={15} aria-hidden="true" />
                    <span className="hidden sm:inline">Sign out</span>
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
                  website or game you can preview, refine and publish.
                </p>

                {onOpenShowcase && (
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <span className="text-sm studio-text-soft">Not sure where to start?</span>
                    <button
                      type="button"
                      onClick={onOpenShowcase}
                      className={`${GHOST_BTN} min-h-[40px] px-4 is-strong`}
                    >
                      <Play size={14} aria-hidden="true" />
                      Explore examples
                    </button>
                  </div>
                )}
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

              {needsSignIn && (
                <div className="mt-10 flex flex-col items-center animate-stagger-3">
                  <button
                    type="button"
                    onClick={onSignIn}
                    className={`studio-primary-btn group inline-flex min-h-[48px] items-center gap-2.5 rounded-xl px-8 py-3 text-sm font-semibold ${FOCUS_RING}`}
                  >
                    <LogIn size={16} aria-hidden="true" />
                    Sign in to start building
                    <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
                  </button>
                  <p className="mt-3 text-sm studio-text-soft">Your projects are saved to your account.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
