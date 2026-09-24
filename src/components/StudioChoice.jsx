import { useEffect } from 'react';
import {
  Zap, Database, Smartphone, Layout, FileText, MousePointerClick, FolderOpen, History, Search, LogIn, LogOut, Sun, Moon,
} from 'lucide-react';
import { STUDIO_MODES } from '../lib/constants';

// Studio choice screen. Two lives:
//   1. Forced gate -- a fresh session with nothing to resume must pick a
//      studio before any workspace exists (no way back, nothing to go back to).
//   2. Mid-session pick -- opened by "New" after the discard confirmation;
//      `onCancel` is set then, so bailing returns to the untouched workspace.
// The cards ARE the explanation -- each one previews the artifact its studio
// produces (a native-feeling app vs. a browser-rendered site), drawn in the
// same miniature-block language as the build overlays.

const CAPABILITIES = {
  app: [
    { Icon: Zap, label: 'Real interactivity' },
    { Icon: Database, label: 'Data persists between sessions' },
    { Icon: Smartphone, label: 'Feels native on a phone' },
  ],
  website: [
    { Icon: Layout, label: 'Complete site anatomy' },
    { Icon: FileText, label: 'Content lives in the HTML' },
    { Icon: MousePointerClick, label: 'Click any element to edit it' },
  ],
  projects: [
    { Icon: History, label: 'Every version, with undo' },
    { Icon: Search, label: 'Search and rename your builds' },
    { Icon: FolderOpen, label: 'Resume exactly where you left off' },
  ],
};

const PROJECTS_CARD = {
  label: 'Open a project',
  description: 'Pick up a saved app or website — the studio, preview and full version history come back with it.',
};

const CTA_LABELS = { app: 'Build an app', website: 'Build a website', projects: 'Open a project' };

// Miniature app screen: hero card, list rows, tiles, tab bar -- and the one
// brand-colored FAB. Fixed navy (#2c70af, the .brand-mark family) so the
// accent reads as the same blue in both themes.
const PhoneArtifact = () => (
  <div className="studio-card-artifact relative w-24 rounded-[24px] border-[3px] border-slate-300 bg-surface p-1.5 shadow-md">
    <div className="relative flex h-44 w-[78px] flex-col gap-1.5 overflow-hidden rounded-[16px] bg-slate-50 p-1.5">
      <div className="flex items-center justify-between px-0.5">
        <span className="h-1 w-5 rounded-full bg-slate-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
      </div>
      <div className="rounded-lg bg-indigo-100 p-1.5">
        <div className="h-1 w-8 rounded-full bg-indigo-300/80" />
        <div className="mt-1 h-1 w-11 rounded-full bg-indigo-300/50" />
      </div>
      <div className="h-3.5 rounded-md bg-slate-200/80" />
      <div className="grid flex-1 grid-cols-2 gap-1">
        <div className="rounded-md bg-slate-200/60" />
        <div className="rounded-md bg-slate-200/60" />
      </div>
      <div className="flex h-4 items-center justify-around rounded-md bg-slate-200/80">
        <span className="h-1 w-1 rounded-full bg-slate-400/70" />
        <span className="h-1 w-1 rounded-full bg-slate-400/70" />
        <span className="h-1 w-1 rounded-full bg-slate-400/70" />
      </div>
      <span className="absolute bottom-6 right-1.5 h-5 w-5 rounded-full bg-[#2c70af] shadow-md" />
    </div>
  </div>
);

// Miniature browser window: chrome bar, nav with CTA chip, hero, columns --
// the website anatomy the Website studio mandates, at thumbnail scale.
const BrowserArtifact = () => (
  <div className="studio-card-artifact w-44 overflow-hidden rounded-xl border-[3px] border-slate-300 bg-surface shadow-md">
    <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-100 px-2 py-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
      <span className="ml-1 h-2 flex-1 rounded-full bg-surface" />
    </div>
    <div className="flex flex-col gap-1.5 bg-slate-50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="h-1.5 w-8 rounded-full bg-slate-300" />
        <div className="flex gap-1">
          <span className="h-1.5 w-3 rounded-full bg-slate-300/60" />
          <span className="h-1.5 w-3 rounded-full bg-slate-300/60" />
          <span className="h-1.5 w-3 rounded-full bg-slate-300/60" />
        </div>
        <span className="h-3 w-7 rounded-[4px] bg-[#2c70af]" />
      </div>
      <div className="flex h-14 flex-col justify-center gap-1 rounded-lg bg-indigo-100 px-2.5">
        <span className="h-2 w-20 rounded-full bg-indigo-300/80" />
        <span className="h-1.5 w-14 rounded-full bg-indigo-300/50" />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <div className="h-8 rounded-md bg-slate-200/70" />
        <div className="h-8 rounded-md bg-slate-200/70" />
        <div className="h-8 rounded-md bg-slate-200/70" />
      </div>
    </div>
  </div>
);

// Miniature saved-projects list: search field, then rows with a studio-colored
// tile, title/subtitle bars and a chevron -- the shape of ProjectsListModal.
const ProjectsArtifact = () => (
  <div className="studio-card-artifact w-44 overflow-hidden rounded-xl border-[3px] border-slate-300 bg-surface shadow-md">
    <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-100 px-2 py-1.5">
      <span className="h-2 w-2 shrink-0 rounded-full border border-slate-300" />
      <span className="h-2 flex-1 rounded-full bg-surface" />
    </div>
    <div className="flex flex-col gap-1.5 bg-slate-50 p-2.5">
      {[0, 1, 2].map((row) => (
        <div key={row} className={`flex items-center gap-2 rounded-md p-1.5 ${row === 0 ? 'bg-indigo-100' : 'bg-slate-200/60'}`}>
          <span className={`h-5 w-5 shrink-0 rounded-md ${row === 0 ? 'bg-[#2c70af]' : 'bg-slate-300'}`} />
          <div className="flex flex-1 flex-col gap-1">
            <span className={`h-1.5 rounded-full ${row === 0 ? 'w-14 bg-indigo-300/80' : 'w-12 bg-slate-300'}`} />
            <span className={`h-1 w-9 rounded-full ${row === 0 ? 'bg-indigo-300/50' : 'bg-slate-300/70'}`} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ARTIFACTS = { app: PhoneArtifact, website: BrowserArtifact, projects: ProjectsArtifact };

export default function StudioChoice({ onSelectStudio, onCancel = null, savedAppsCount = 0, onOpenProjects, requireSignIn = false, isSignedIn = true, onSignIn, onSignOut, resolvedTheme = 'light', onThemeChange }) {
  // Escape mirrors the on-screen back control, but only when there is
  // something to go back to (the forced gate has none).
  useEffect(() => {
    if (!onCancel) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
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
    <div className="studio-choice relative flex-1 min-h-0 overflow-hidden">
      {/* SaaS backdrop: drifting aurora + fading grid (see studio-choice.css).
          Pinned to the non-scrolling shell so it stays put while the content
          scrolls on short screens. */}
      <div className="studio-bg pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative z-1 h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center px-4 py-10 sm:px-8">
          {/* Zero-size defs for the dark-theme logo: alpha = 3*(R+G+B), so the
              logo's opaque black field becomes transparent (see studio-choice.css). */}
          <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
            <filter id="studio-logo-key" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 3 3 0 0" />
            </filter>
          </svg>
          <div className="studio-logo-badge animate-stagger-1">
            <img src="/newlog.webp" alt="AppBlips" className="studio-logo-img" />
          </div>

          <h1 className="mt-6 text-center text-3xl sm:text-4xl font-black tracking-tight text-slate-950 dark:text-white leading-[1.08] animate-stagger-2">
            What are you building?
          </h1>
          <p className="mt-2.5 max-w-[52ch] text-center text-sm font-medium text-slate-600 dark:text-white/85 animate-stagger-2">
            Pick a studio to start in — it shapes the prompts, the preview, and the editing tools.
          </p>

          {requireSignIn && !isSignedIn && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 animate-stagger-2">
              <span className="text-sm font-medium text-slate-600 dark:text-white/85">
                Sign in to start building.
              </span>
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2c70af] px-4 py-2 text-sm font-semibold text-white shadow-premium-sm transition-colors hover:bg-[#245d92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
              >
                <LogIn size={15} aria-hidden="true" />
                Sign in
              </button>
            </div>
          )}

          <div className="mt-8 grid w-full gap-5 md:grid-cols-2 lg:grid-cols-3 animate-stagger-3">
            {['app', 'website', 'projects'].map((key) => {
              const isProjects = key === 'projects';
              const mode = isProjects ? PROJECTS_CARD : STUDIO_MODES[key];
              const Artifact = ARTIFACTS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={isProjects ? handleOpenProjects : () => onSelectStudio(key)}
                  aria-label={CTA_LABELS[key]}
                  className={`studio-card flex flex-col rounded-3xl border border-slate-200 bg-surface p-5 text-left shadow-premium-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 sm:p-6${isProjects ? ' md:col-span-2 lg:col-span-1' : ''}`}
                >
                  <div className="studio-card-well workspace-grid mb-5 flex h-52 items-center justify-center rounded-2xl bg-slate-50 shadow-[inset_0_1px_3px_rgb(15_23_42/0.06),inset_0_0_0_1px_rgb(15_23_42/0.04)]">
                    <Artifact />
                  </div>

                  <h2 className="text-lg font-bold tracking-tight text-slate-950 dark:text-white">
                    {mode.label}
                  </h2>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-600 dark:text-white/85">
                    {mode.description}
                  </p>

                  <div className="mt-4 space-y-2">
                    {CAPABILITIES[key].map((cap) => {
                      const { Icon, label } = cap;
                      return (
                        <div key={label} className="flex items-center gap-2 text-[13px] font-medium text-slate-600 dark:text-white/80">
                          <Icon size={14} className="shrink-0 text-indigo-500 dark:text-indigo-300" aria-hidden="true" />
                          <span>{label}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <span className="studio-card-cta inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold">
                      {CTA_LABELS[key]}
                    </span>
                    {isProjects && savedAppsCount > 0 && (
                      <span className="text-[13px] font-medium text-slate-500 dark:text-white/70">
                        {savedAppsCount} saved
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Exits from the choice: sign out, theme, or -- mid-session only --
              backing out. */}
          {(onCancel || canSignOut || onThemeChange) && (
            <div className="mt-6 flex items-center gap-3 animate-stagger-3">
              {canSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="studio-exit inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:text-slate-950 dark:text-white dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
                >
                  <LogOut size={15} className="text-indigo-500 dark:text-indigo-300" aria-hidden="true" />
                  Sign out
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900 dark:text-white/75 dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
                >
                  Go back
                </button>
              )}
              {onThemeChange && (
                <button
                  type="button"
                  onClick={() => onThemeChange(resolvedTheme === 'dark' ? 'light' : 'dark')}
                  aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                  title={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                  className="studio-exit inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-colors hover:text-slate-950 dark:text-white/80 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
                >
                  {resolvedTheme === 'dark'
                    ? <Sun size={17} aria-hidden="true" />
                    : <Moon size={17} aria-hidden="true" />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
