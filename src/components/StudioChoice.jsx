import { useEffect, useState } from 'react';
import {
  ArrowRight, CircleHelp, FolderUp, Gamepad2, Github, LibraryBig, Menu, MonitorSmartphone,
  Moon, ScrollText, ShieldCheck, Settings, Smartphone, Sparkles, Sun, X,
} from 'lucide-react';
import { DOCS_URL, GITHUB_URL, DISCORD_URL } from '../lib/constants';
import BorderGlow from './reactbits/BorderGlow';
import RotatingText from './reactbits/RotatingText';

// Lucide has no Discord mark, so this is the brand's own glyph (official
// invite/widget assets), drawn to match the lucide icons' ~17px box.
export function DiscordIcon({ size = 17, ...props }) {
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
];

// The heading's rotating word ("Build an app", "Build a website", ...).
const ROTATING_STUDIOS = ['an app', 'a website', 'a game'];

// Hover glow on every card (React Bits' BorderGlow; the glass-card tweaks are
// in studio-choice.css). Dark keeps the picker's monochrome-plus-brand-red
// look, so every card glows in the wordmark's red family. Light gives each
// card its own --tint (same hues as studio-choice.css) so the glow matches
// the icon tile and call to action.
const GLOW_DARK = { glowColor: '8 90 74', colors: ['#ec6452', '#f59e0b', '#f472b6'] };
const GLOW_LIGHT = {
  app: { glowColor: '221 83 53', colors: ['#2563eb', '#60a5fa', '#818cf8'] },
  website: { glowColor: '192 82 31', colors: ['#0e7490', '#22d3ee', '#38bdf8'] },
  game: { glowColor: '17 88 40', colors: ['#c2410c', '#fb923c', '#f43f5e'] },
  projects: { glowColor: '163 94 24', colors: ['#047857', '#34d399', '#2dd4bf'] },
  import: { glowColor: '215 25 27', colors: ['#334155', '#94a3b8', '#64748b'] },
  showcase: { glowColor: '336 74 42', colors: ['#be185d', '#f472b6', '#fb7185'] },
};

function GlowCard({ studio, isDark, children }) {
  const { glowColor, colors } = isDark ? GLOW_DARK : GLOW_LIGHT[studio];
  return (
    <BorderGlow
      className="studio-glow-card"
      // Only picks the blend mode (plus-lighter on dark, normal on light):
      // the card's own glass background shows, not this colour.
      backgroundColor={isDark ? '#080808' : '#ffffff'}
      borderRadius={16}
      glowRadius={24}
      edgeSensitivity={30}
      coneSpread={25}
      glowIntensity={isDark ? 1 : 0.8}
      fillOpacity={isDark ? 0.2 : 0.15}
      glowColor={glowColor}
      colors={colors}
    >
      {children}
    </BorderGlow>
  );
}

// Colours come from the studio-* classes (studio-choice.css), not Tailwind's
// white/black utilities, so each one has a dark and a light value.
const FOCUS_RING = 'studio-focus';
const NAV_LINK = `studio-nav-link rounded-md px-1 text-sm font-medium ${FOCUS_RING}`;
const GHOST_BTN = `studio-ghost-btn inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium ${FOCUS_RING}`;

const MENU_ITEM = `studio-menu-item ${FOCUS_RING}`;

export default function StudioChoice({ onSelectStudio, onCancel = null, savedAppsCount = 0, onOpenProjects, onOpenSettings, onImportSite = null, onOpenShowcase = null, resolvedTheme, onToggleTheme = null }) {
  // Escape mirrors the on-screen close control, but only when there is
  // something to go back to (the forced gate has none). A modal open over the
  // picker (e.g. Settings) handles its own Escape first.
  // Mobile slide-out menu. Escape closes it before it would close the picker.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!onCancel && !menuOpen) return;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (menuOpen) setMenuOpen(false);
      else onCancel?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, menuOpen]);

  // Runs the action after the panel has started closing, so a modal (Settings)
  // doesn't open over a menu that is still on screen.
  const fromMenu = (fn) => () => { setMenuOpen(false); fn?.(); };

  const isDark = resolvedTheme === 'dark';

  const handleOpenProjects = () => {
    onOpenProjects?.();
  };

  const EXTRA_ROWS = [
    {
      key: 'projects',
      Icon: LibraryBig,
      title: 'My projects',
      description: 'Pick up where you left off.',
      label: 'My projects: open a saved project',
      onClick: handleOpenProjects,
      badge: savedAppsCount > 0 && (
        <span className="studio-saved-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold">
          {savedAppsCount} saved
        </span>
      ),
    },
    {
      key: 'import',
      Icon: FolderUp,
      title: 'Import a site',
      description: 'Open a React + Vite project from a .zip and keep editing it with AI.',
      label: 'Import a site: open a React + Vite project from a .zip',
      onClick: onImportSite,
      hidden: !onImportSite,
      badge: (
        <span className="studio-beta-badge shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Beta</span>
      ),
    },
    {
      key: 'showcase',
      Icon: Sparkles,
      title: 'Explore',
      description: 'See what people built with one prompt, and share your own.',
      label: 'Explore: see what people have built with AppBlips',
      onClick: onOpenShowcase,
      hidden: !onOpenShowcase,
    },
  ];

  return (
    <div className="studio-choice relative flex-1 min-h-0 overflow-hidden">
      {/* overflow-x-hidden: the glow's outer layer extends 24px past each card,
          which on a phone sticks out of the viewport and gave this scroller
          sideways slack. Clipping here keeps the glow on desktop widths. */}
      <div className="relative h-full overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full flex-col">
          {/* Top bar, like the landing page's: mark left, quick links centred
              (md+), GitHub, theme and settings on the right. */}
          <nav className="studio-topbar sticky top-0 z-20 shrink-0">
            <div className="studio-topbar-inner relative mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:h-20 sm:px-6 md:px-10">
              <span className="studio-logo mr-auto">
                <img src="/favicon.svg" alt="" aria-hidden="true" className="studio-logo-icon" />
                <img src="/appblips-wordmark-dark.svg" alt="AppBlips" className="studio-logo-img studio-logo-dark" />
                <img src="/appblips-wordmark-light.svg" alt="" aria-hidden="true" className="studio-logo-img studio-logo-light" />
              </span>


              <div className="flex items-center gap-2">
                <a
                  href={DOCS_URL}
                  draggable={false}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Help and documentation"
                  title="Help and documentation"
                  className={`${GHOST_BTN} h-9 w-9 max-md:hidden`}
                >
                  <CircleHelp size={17} aria-hidden="true" />
                </a>
                {onToggleTheme && (
                  <button
                    type="button"
                    onClick={onToggleTheme}
                    aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                    title={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                    className={`${GHOST_BTN} h-9 w-9 max-md:hidden`}
                  >
                    {resolvedTheme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
                  </button>
                )}
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    aria-label="Settings"
                    title="Settings"
                    className={`${GHOST_BTN} h-9 w-9 max-md:hidden`}
                  >
                    <Settings size={17} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  aria-label="Open menu"
                  aria-expanded={menuOpen}
                  aria-controls="studio-mobile-menu"
                  className={`${GHOST_BTN} h-9 w-9 md:hidden`}
                >
                  <Menu size={18} aria-hidden="true" />
                </button>
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

            <div className="studio-main relative mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-10 sm:px-6 sm:py-14 md:px-10">
              <header className="flex flex-col items-center text-center animate-stagger-1">
                {/* The visible heading cycles through the three studios; screen
                    readers get one stable sentence instead of a changing one. */}
                <h1 className="studio-title text-4xl font-bold leading-[1.05] tracking-tight studio-text-strong sm:text-5xl md:text-6xl">
                  <span className="sr-only">What will you build? An app, a website or a game.</span>
                  <span className="studio-title-line" aria-hidden="true">
                    <span>Build</span>
                    <RotatingText
                      texts={ROTATING_STUDIOS}
                      mainClassName="studio-rotate"
                      highlight
                      fixedWidth
                      highlightColor={isDark ? '#ec6452' : '#d9472f'}
                      effect="slide"
                      splitBy="characters"
                      staggerDuration={0.02}
                      staggerFrom="last"
                      rotationInterval={2600}
                    />
                  </span>
                </h1>
                <p className="studio-lead mt-4 max-w-2xl text-base leading-snug studio-text-muted sm:mt-5 sm:text-lg">
                  Describe what you want in plain English. AppBlips builds a working app,
                  website or game you can preview and refine.
                </p>
              </header>

              {/* The three ways to make something new: big cards. */}
              <div className="studio-grid mt-10 grid animate-stagger-3">
                {STUDIOS.map(({ key, Icon, title, description, cta }) => (
                  <GlowCard key={key} studio={key} isDark={isDark}>
                    <button
                      type="button"
                      onClick={() => onSelectStudio(key)}
                      aria-label={`${cta}: ${title}`}
                      data-studio={key}
                      className={`studio-card group relative flex flex-col rounded-2xl text-left ${FOCUS_RING}`}
                    >
                      <span className="studio-card-body flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-3">
                          <span className="studio-icon-tile flex shrink-0 items-center justify-center rounded-xl">
                            <Icon className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <span className="studio-card-title block text-base font-semibold studio-text-strong sm:text-lg">{title}</span>
                        </span>
                        <span className="studio-card-desc mt-2 block text-sm leading-relaxed studio-text-soft">{description}</span>
                        <span className="studio-card-cta inline-flex items-center gap-1.5 text-sm font-semibold studio-text-strong" aria-hidden="true">
                          <span className="studio-cta-label">{cta}</span>
                          <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
                        </span>
                      </span>
                    </button>
                  </GlowCard>
                ))}
              </div>

              {/* Starting from something that already exists: your projects
                  and templates, an imported site, or Explore. Slimmer
                  rows so the studios above stay the obvious first choice. */}
              <div className="studio-extra-rows grid animate-stagger-3">
                {EXTRA_ROWS.filter((row) => !row.hidden).map(({ key, Icon, title, description, label, onClick, badge }) => (
                  <GlowCard key={key} studio={key} isDark={isDark}>
                    <button
                      type="button"
                      onClick={onClick}
                      aria-label={label}
                      data-studio={key}
                      className={`studio-card group flex items-center gap-3 rounded-2xl text-left ${FOCUS_RING}`}
                    >
                      <span className="studio-icon-tile flex shrink-0 items-center justify-center rounded-xl">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-2">
                          <span className="block truncate text-base font-semibold studio-text-strong">{title}</span>
                          {badge}
                        </span>
                        <span className="studio-card-desc mt-0.5 block text-sm leading-snug studio-text-soft">{description}</span>
                      </span>
                      {/* Arrow only: the row's title already says what it does,
                          and a label would squeeze the text at three across. */}
                      <span className="studio-card-cta inline-flex shrink-0 studio-text-strong" aria-hidden="true">
                        <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
                      </span>
                    </button>
                  </GlowCard>
                ))}
              </div>
            </div>
          </div>

          <footer className="studio-footer relative shrink-0">
            <div className="studio-footer-inner flex flex-col-reverse items-center gap-1 px-4 py-3 sm:py-4 sm:px-6 md:flex-row md:justify-center md:gap-6 md:px-10">
              <nav aria-label="Footer links" className="flex-wrap max-md:hidden flex items-center justify-center gap-x-4 gap-y-1 whitespace-nowrap sm:gap-x-6">
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
              <p className="studio-text-soft pb-1 text-xs">© 2026 TechMitten LLC. All rights reserved.</p>
            </div>
          </footer>
        </div>
      </div>

      {/* Mobile slide-out menu (below md): everything the header and footer
          drop at that width. Always mounted so it can animate; `inert` keeps
          the closed panel out of tab order and the accessibility tree. */}
      <div className="md:hidden" data-open={menuOpen}>
        <div className="studio-menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
        <aside
          id="studio-mobile-menu"
          className="studio-menu-panel"
          aria-label="Menu"
          inert={!menuOpen}
        >
          <div className="studio-menu-head">
            <span className="text-sm font-semibold studio-text-strong">Menu</span>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className={`${GHOST_BTN} h-9 w-9`}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="studio-menu-list">
            {onOpenSettings && (
              <button type="button" className={MENU_ITEM} onClick={fromMenu(onOpenSettings)}>
                <Settings size={18} aria-hidden="true" /> Settings
              </button>
            )}
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={MENU_ITEM} onClick={fromMenu()}>
              <CircleHelp size={18} aria-hidden="true" /> Help
            </a>
            {onToggleTheme && (
              <button type="button" className={MENU_ITEM} onClick={onToggleTheme}>
                {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
                {isDark ? 'Light theme' : 'Dark theme'}
              </button>
            )}
            <div className="studio-menu-sep" role="separator" />
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={MENU_ITEM} onClick={fromMenu()}>
              <Github size={18} aria-hidden="true" /> GitHub
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className={MENU_ITEM} onClick={fromMenu()}>
              <DiscordIcon size={18} /> Discord
            </a>
            <div className="studio-menu-sep" role="separator" />
            <a href="https://www.appblips.com/privacy" target="_blank" rel="noopener noreferrer" className={MENU_ITEM} onClick={fromMenu()}>
              <ShieldCheck size={18} aria-hidden="true" /> Privacy Policy
            </a>
            <a href="https://www.appblips.com/terms" target="_blank" rel="noopener noreferrer" className={MENU_ITEM} onClick={fromMenu()}>
              <ScrollText size={18} aria-hidden="true" /> Terms of Service
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
