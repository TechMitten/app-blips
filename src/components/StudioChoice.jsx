import { useEffect } from 'react';
import {
  FileText, History, Search, LogIn, LogOut, Settings, CircleHelp,
  CheckCircle2, Cloud, Files, Code2, Rocket, ChevronRight,
} from 'lucide-react';
import { DOCS_URL } from '../lib/constants';

// Studio choice screen. Two lives:
//   1. Forced gate -- a fresh session with nothing to resume must pick a
//      studio before any workspace exists (no way back, nothing to go back to).
//   2. Mid-session pick -- opened by "New" after the discard confirmation;
//      `onCancel` is set then, so bailing returns to the untouched workspace.
// A deliberately branded, always-dark stage (see studio-choice.css): the cards
// preview the artifact each studio produces via product imagery.

const CARD_TITLES = { app: 'Mobile & Web App', website: 'Responsive Website', projects: 'Quick Start & Library' };
const CTA_LABELS = { app: 'Build an app', website: 'Build a website', projects: 'Browse Templates' };

const CAPABILITIES = {
  app: [
    { Icon: Settings, label: 'Fully Interactive & Logic-Driven' },
    { Icon: CheckCircle2, label: 'Native Device Experience' },
    { Icon: Cloud, label: 'Integrated Data Persistence' },
  ],
  website: [
    { Icon: FileText, label: 'Content-First Architecture' },
    { Icon: Files, label: 'Perfect for Portfolios & Blogs' },
    { Icon: Code2, label: 'SEO-Ready HTML Structure' },
  ],
  projects: [
    { Icon: Rocket, label: 'Use a Pre-made Template' },
    { Icon: History, label: 'Resume or Clone Previous Work' },
    { Icon: Search, label: 'Explore Design Inspiration' },
  ],
};

const CARD_IMAGES = {
  app: { src: '/studio/apps.png', alt: 'Mobile app dashboard on a phone' },
  website: { src: '/studio/websites.png', alt: 'Responsive website on a laptop and phones' },
  projects: { src: '/studio/openproject.png', alt: 'Project library on a laptop and phone' },
};

export default function StudioChoice({ onSelectStudio, onCancel = null, savedAppsCount = 0, onOpenProjects, requireSignIn = false, isSignedIn = true, onSignIn, onSignOut, onOpenSettings }) {
  // Escape mirrors the on-screen back control, but only when there is
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

  // Hosted mode keeps projects in the account, so signed-out there is nothing
  // to list -- ask for sign-in instead of opening an empty modal.
  const handleOpenProjects = () => {
    if (requireSignIn && !isSignedIn) onSignIn?.();
    else onOpenProjects?.();
  };

  return (
    <div className="studio-choice force-dark relative flex-1 min-h-0 overflow-hidden">
      {/* Deep-navy stage: drifting teal aurora over a starfield
          (see studio-choice.css). Pinned to the non-scrolling shell so it
          stays put while the content scrolls on short screens. */}
      <div className="studio-bg pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative z-1 h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6 sm:px-8">
          {/* Zero-size defs for the logo: alpha = 3*(R+G+B), so the mark's
              opaque black field becomes transparent (see studio-choice.css). */}
          <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
            <filter id="studio-logo-key" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 3 3 0 0" />
            </filter>
          </svg>

          <div className="studio-panel relative flex flex-1 flex-col rounded-[28px] px-6 py-10 sm:px-12 sm:py-10">
            {/* Exits from the choice, tucked into the top-right corner:
                sign out / back, then settings and help. */}
            <div className="mb-6 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 animate-stagger-1">
              {/* Mobile: the mark sits top-left, aligned with the icons. */}
              <div className="studio-logo-badge studio-logo-badge--compact mr-auto sm:hidden">
                <img src="/newlog.webp" alt="AppBlips" className="studio-logo-img" />
              </div>

              {/* Exits from the choice, tucked into the top-right corner:
                  sign out / back, then settings and help. */}
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                {canSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70"
                  >
                    <LogOut size={15} aria-hidden="true" />
                    Sign out
                  </button>
                )}
                {onCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="text-sm font-semibold text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70"
                  >
                    Go back
                  </button>
                )}
                <div className="flex items-center gap-2.5">
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      aria-label="Settings"
                      title="Settings"
                      className="studio-icon-btn inline-flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70"
                    >
                      <Settings size={17} aria-hidden="true" />
                    </button>
                  )}
                  <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Help and documentation"
                    title="Help and documentation"
                    className="studio-icon-btn inline-flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70"
                  >
                    <CircleHelp size={17} aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>

            <header className="flex flex-col items-center text-center animate-stagger-1">
              {/* On sm+ the mark lifts up into the controls row and centers
                  against the icon buttons; the negative margins keep the
                  heading below exactly where it was. */}
              <div className="studio-logo-badge hidden sm:block sm:-mt-[60px] sm:mb-[60px] sm:-translate-y-[20px]">
                <img src="/newlog.webp" alt="AppBlips" className="studio-logo-img" />
              </div>

              <h1 className="mt-6 text-[clamp(1.2rem,6.4vw,2.75rem)] font-black tracking-tight text-white sm:text-5xl">
                What will you build?
              </h1>
              <p className="mt-3 max-w-[52ch] text-base font-medium text-white/60">
                Start with an app, a website, or something you&rsquo;ve already made.
              </p>

              {requireSignIn && !isSignedIn && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <span className="text-sm font-medium text-white/70">Sign in to start building.</span>
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#17b8a6] to-[#2f7fd0] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70"
                  >
                    <LogIn size={15} aria-hidden="true" />
                    Sign in
                  </button>
                </div>
              )}
            </header>

            <div className="mt-8 grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-3 animate-stagger-3">
              {['app', 'website', 'projects'].map((key) => {
                const isProjects = key === 'projects';
                const image = CARD_IMAGES[key];
                const hasChevron = !isProjects;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={isProjects ? handleOpenProjects : () => onSelectStudio(key)}
                    aria-label={CTA_LABELS[key]}
                    className={`studio-card group flex flex-col rounded-3xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08131f] sm:p-5${isProjects ? ' sm:col-span-2 lg:col-span-1' : ''}`}
                  >
                    <div className="studio-card-well relative mb-5 flex h-60 items-center justify-center">
                      <img src={image.src} alt={image.alt} className="studio-card-image" loading="lazy" />
                      {isProjects && savedAppsCount > 0 && (
                        <span className="absolute right-1 top-1 inline-flex items-center rounded-full border border-white/10 bg-black/45 px-3 py-1 text-xs font-semibold text-white/75 backdrop-blur-sm">
                          {savedAppsCount} saved
                        </span>
                      )}
                    </div>

                    <h2 className="px-1 text-2xl font-bold tracking-tight text-white">{CARD_TITLES[key]}</h2>

                    <div className="mt-4 space-y-2.5 px-1">
                      {CAPABILITIES[key].map((cap) => {
                        const { Icon, label } = cap;
                        return (
                          <div key={label} className="flex items-center gap-2.5 text-sm font-medium text-white/80">
                            <Icon size={16} className="shrink-0 text-white/90" aria-hidden="true" />
                            <span>{label}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-auto pt-6">
                      <span className="studio-card-cta flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold">
                        {CTA_LABELS[key]}
                        {hasChevron && <ChevronRight size={18} aria-hidden="true" />}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
