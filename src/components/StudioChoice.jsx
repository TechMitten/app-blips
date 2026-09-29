import { useEffect } from 'react';
import {
  FileText, History, Search, LogIn, LogOut, Settings, CircleHelp,
  CheckCircle2, Cloud, Files, Code2, Rocket, ChevronRight, LayoutGrid,
  Gamepad2, Trophy, Smartphone,
} from 'lucide-react';
import { DOCS_URL } from '../lib/constants';

// Studio choice screen. Two lives:
//   1. Forced gate -- a fresh session with nothing to resume must pick a
//      studio before any workspace exists (no way back, nothing to go back to).
//   2. Mid-session pick -- opened by "New" after the discard confirmation;
//      `onCancel` is set then, so bailing returns to the untouched workspace.
// A deliberately branded, always-dark stage (see studio-choice.css): the cards
// preview the artifact each studio produces via product imagery.

const CARD_TITLES = { app: 'Mobile & Web App', website: 'Responsive Website', game: 'Browser Game', projects: 'Quick Start & Library' };
const CTA_LABELS = { app: 'Build an app', website: 'Build a website', game: 'Build a game', projects: 'Browse Templates' };

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
  game: [
    { Icon: Gamepad2, label: 'Canvas 2D & Phaser Engines' },
    { Icon: Trophy, label: 'Score, Levels & Juice' },
    { Icon: Smartphone, label: 'Touch + Keyboard Controls' },
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
  game: { src: '/gamecard.png', alt: 'Playable browser game on a phone and laptop' },
  projects: { src: '/studio/openproject.png', alt: 'Project library on a laptop and phone' },
};

export default function StudioChoice({ onSelectStudio, onCancel = null, savedAppsCount = 0, onOpenProjects, requireSignIn = false, isSignedIn = true, onSignIn, onSignOut, onOpenSettings, onOpenGallery }) {
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
        <div className="mx-auto flex h-full min-h-[34rem] w-full max-w-6xl flex-col px-4 py-3 sm:px-8 sm:py-4">
          {/* Zero-size defs for the logo: alpha = 3*(R+G+B), so the mark's
              opaque black field becomes transparent (see studio-choice.css). */}
          <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
            <filter id="studio-logo-key" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 3 3 0 0" />
            </filter>
          </svg>

          <div className="studio-panel relative flex min-h-0 flex-1 flex-col rounded-[28px] px-4 py-4 sm:px-8 sm:py-5 lg:px-12 lg:py-6">
            {/* Exits from the choice, tucked into the top-right corner:
                sign out / back, then settings and help. */}
            <div className="mb-2 flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 animate-stagger-1 sm:mb-3">
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
                {onOpenGallery && (
                  <button
                    type="button"
                    onClick={onOpenGallery}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70"
                  >
                    <LayoutGrid size={15} aria-hidden="true" />
                    Explore the Gallery
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

            <header className="flex shrink-0 flex-col items-center text-center animate-stagger-1">
              {/* On sm+ the mark lifts up into the controls row and centers
                  against the icon buttons; the negative margins keep the
                  heading below exactly where it was. Kept modest so the mark
                  does not eat the height the cards need. */}
              <div className="studio-logo-badge hidden sm:block sm:-mt-[38px] sm:mb-[6px] sm:-translate-y-[8px]">
                <img src="/newlog.webp" alt="AppBlips" className="studio-logo-img" />
              </div>

              <h1 className="mt-4 text-[clamp(1.2rem,6.4vw,2.75rem)] font-black tracking-tight text-white sm:mt-1 sm:text-4xl">
                What will you build?
              </h1>
              <p className="mt-2 max-w-[52ch] text-sm font-medium text-white/60 sm:mt-1.5 sm:text-base">
                Start with an app, a website, a game, or something you&rsquo;ve already made.
              </p>

              {requireSignIn && !isSignedIn && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
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

            <div className="mt-3 grid min-h-0 w-full flex-1 grid-cols-2 grid-rows-2 gap-2.5 animate-stagger-3 sm:mt-4 sm:gap-4">
              {['app', 'website', 'game', 'projects'].map((key) => {
                const isProjects = key === 'projects';
                const image = CARD_IMAGES[key];
                const hasChevron = !isProjects;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={isProjects ? handleOpenProjects : () => onSelectStudio(key)}
                    aria-label={CTA_LABELS[key]}
                    className="studio-card group flex min-h-0 flex-col overflow-hidden rounded-3xl p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08131f] sm:p-4"
                  >
                    <div className="studio-card-well relative mb-2 flex min-h-[2.5rem] flex-1 items-center justify-center sm:mb-3">
                      <img src={image.src} alt={image.alt} className="studio-card-image" loading="lazy" />
                      {isProjects && savedAppsCount > 0 && (
                        <span className="absolute right-1 top-1 inline-flex items-center rounded-full border border-white/10 bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/75 backdrop-blur-sm sm:px-3 sm:py-1 sm:text-xs">
                          {savedAppsCount} saved
                        </span>
                      )}
                    </div>

                    <h2 className="px-1 text-sm font-bold leading-tight tracking-tight text-white sm:text-lg lg:text-xl">{CARD_TITLES[key]}</h2>

                    <div className="studio-card-capabilities mt-2 space-y-1.5 px-1">
                      {CAPABILITIES[key].map((cap) => {
                        const { Icon, label } = cap;
                        return (
                          <div key={label} className="flex items-center gap-2 text-xs font-medium text-white/80 lg:text-sm">
                            <Icon size={14} className="shrink-0 text-white/90" aria-hidden="true" />
                            <span>{label}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-auto pt-2 sm:pt-3">
                      <span className="studio-card-cta flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-sm">
                        {CTA_LABELS[key]}
                        {hasChevron && <ChevronRight size={15} className="shrink-0" aria-hidden="true" />}
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
