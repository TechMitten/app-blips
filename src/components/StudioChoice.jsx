import { useEffect } from 'react';
import {
  Zap, Database, Smartphone, Layout, FileText, MousePointerClick, FolderOpen, LogIn, LogOut,
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
};

const CTA_LABELS = { app: 'Build an app', website: 'Build a website' };

// Miniature app screen: hero card, list rows, tiles, tab bar -- and the one
// brand-colored FAB. Fixed navy (#2c70af, the .brand-mark family) so the
// accent reads as the same blue in both themes.
const PhoneArtifact = () => (
  <div className="studio-card-artifact relative w-24 rounded-[24px] border-[3px] border-slate-300 bg-surface p-1.5 shadow-md transition-transform duration-300 group-hover:-translate-y-1">
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
  <div className="studio-card-artifact w-44 overflow-hidden rounded-xl border-[3px] border-slate-300 bg-surface shadow-md transition-transform duration-300 group-hover:-translate-y-1">
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

const ARTIFACTS = { app: PhoneArtifact, website: BrowserArtifact };

export default function StudioChoice({ onSelectStudio, onCancel = null, savedAppsCount = 0, onOpenProjects, requireSignIn = false, isSignedIn = true, onSignIn, onSignOut }) {
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

  return (
    <div className="studio-choice relative flex-1 min-h-0 overflow-y-auto">
      {/* Same atmospheric wash the build panel's empty state uses, so the
          gate reads as the front door of the same room. */}
      <div className="pointer-events-none absolute inset-0 prompt-atmosphere prompt-atmosphere-hero" aria-hidden="true" />

      <div className="relative z-1 mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="studio-logo-badge animate-stagger-1">
          <img src="/appblips-logo.png" alt="AppBlips" className="h-20 w-auto" />
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

        <div className="mt-8 grid w-full gap-5 md:grid-cols-2 animate-stagger-3">
          {['app', 'website'].map((key) => {
            const mode = STUDIO_MODES[key];
            const Artifact = ARTIFACTS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectStudio(key)}
                aria-label={CTA_LABELS[key]}
                className="studio-card group flex flex-col rounded-3xl border border-slate-200 bg-surface p-5 text-left shadow-premium-md transition-all duration-300 hover:-translate-y-1 hover:border-indigo-300/70 hover:shadow-premium-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 sm:p-6"
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

                <span className="studio-card-cta mt-6 self-start inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold">
                  {CTA_LABELS[key]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Exits from the choice: reopening a previous build (when any
            exist), or -- mid-session only -- backing out. */}
        {(onCancel || canSignOut || (savedAppsCount > 0 && onOpenProjects)) && (
          <div className="mt-6 flex items-center gap-3 animate-stagger-3">
            {savedAppsCount > 0 && onOpenProjects && (
              <button
                type="button"
                onClick={onOpenProjects}
                className="studio-exit inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:text-slate-950 dark:text-white dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
              >
                <FolderOpen size={15} className="text-indigo-500 dark:text-indigo-300" aria-hidden="true" />
                Open a previous build
              </button>
            )}
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
          </div>
        )}
      </div>
    </div>
  );
}
