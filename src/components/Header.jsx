import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, FolderOpen, PanelLeftClose, PanelLeftOpen, Sun, Moon,
  Settings, CircleHelp, LogIn, BarChart3, Menu, X, UserRound, Smartphone, Globe
} from 'lucide-react';
import { STUDIO_MODES } from '../lib/constants';


// Top bar: brand + current-app pill on the left; studio switch, New App /
// Apps / History / Settings / Help / auth / theme on the right.
export default function Header({
  projectName,
  onNewApp,
  savedAppsCount,
  versionsCount,
  onOpenApps,
  isHistoryOpen,
  onToggleHistory,
  resolvedTheme,
  onToggleTheme,
  onOpenSettings,
  onOpenHelp,
  authStatus,
  isSignedIn,
  userEmail,
  onOpenAccountSettings,
  onSignIn,
  firebaseEnabled,
  onOpenAnalytics,
  studioMode = 'app',
  onStudioModeChange,
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const trigger = triggerRef.current;
    const root = document.getElementById('root');
    const previousInert = root?.inert;
    if (root) root.inert = true;
    menuRef.current?.querySelector('button')?.focus({ preventScroll: true });
    const query = window.matchMedia('(min-width: 1024px)');
    const onResize = () => { if (query.matches) setIsMobileMenuOpen(false); };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setIsMobileMenuOpen(false);
      if (event.key !== 'Tab') return;
      const buttons = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    query.addEventListener('change', onResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      query.removeEventListener('change', onResize);
      if (root) root.inert = previousInert;
      trigger?.focus({ preventScroll: true });
    };
  }, [isMobileMenuOpen]);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const runMobileAction = (action) => {
    closeMobileMenu();
    action?.();
  };

  const hasProjectName = Boolean(projectName && projectName !== 'Untitled App' && projectName !== 'Untitled Website');
  const untitledName = STUDIO_MODES[studioMode]?.untitledName || 'Untitled App';
  const displayName = hasProjectName ? projectName : untitledName;
  const article = STUDIO_MODES[studioMode]?.article || 'app';

  return (
    <header className="app-header dark force-dark shrink-0 bg-surface/95 backdrop-blur-md border-b border-slate-200 header-shadow px-3 sm:px-5 2xl:px-8 py-2 2xl:py-2.5 flex items-center justify-between gap-2 sm:gap-3 sticky top-0 z-40 transition-colors">
      {/* Left: Brand lockup, then the current-app nameplate */}
      <div className="flex items-center gap-2.5 min-w-0">
        <img src="/appblips-logo.png" alt="AppBlips" className="h-12 w-auto object-contain shrink-0" />
        <span className="nav-divider" aria-hidden="true" />
        <div
          className={`nav-nameplate max-w-[160px] xl:max-w-[300px] 2xl:max-w-[420px] ${hasProjectName ? 'text-slate-900' : 'text-slate-500'}`}
          title={hasProjectName ? `Current ${article}: ${projectName}` : untitledName}
        >
          {hasProjectName && <span className="nav-nameplate-dot" aria-hidden="true" />}
          <span className="truncate">{displayName}</span>
        </div>
      </div>

      {/* Right: a ranked control strip -- one solid key, workspace controls,
          environment controls, then account/theme, split by hairlines. */}
      <nav className="hidden lg:flex items-center gap-3 shrink-0" aria-label="Workspace actions">
        {/* Rank 1: Studio mode + Primary Action. Switching studios starts a
            fresh workspace (App confirms when work would be lost); every
            project remembers which studio created it. */}
        <div className="nav-segmented-group" role="group" aria-label="Studio mode" title="Switch studio">
          <button
            onClick={() => onStudioModeChange('app')}
            aria-pressed={studioMode === 'app'}
            className={`nav-segmented-btn px-3 py-1.5 text-xs font-semibold ${studioMode === 'app' ? 'nav-segmented-btn-active' : ''}`}
            title="App Studio — prompt-to-app builder"
          >
            <Smartphone size={14} />
            <span>App</span>
          </button>
          <button
            onClick={() => onStudioModeChange('website')}
            aria-pressed={studioMode === 'website'}
            className={`nav-segmented-btn px-3 py-1.5 text-xs font-semibold ${studioMode === 'website' ? 'nav-segmented-btn-active' : ''}`}
            title="Website Studio — prompt-to-website builder with click-to-edit"
          >
            <Globe size={14} />
            <span>Website</span>
          </button>
        </div>

        <button
          onClick={onNewApp}
          className="nav-btn nav-btn-primary group"
          title={`Start a new ${article}`}
          aria-label={`Start a new ${article}`}
        >
          <Plus size={16} strokeWidth={2.4} />
          <span>New {STUDIO_MODES[studioMode]?.label || 'App'}</span>
        </button>

        {/* Rank 2: Workspace -- the app you are building */}
        <span className="nav-divider" aria-hidden="true" />
        <div className="nav-rank">
          <button
            data-tour="apps"
            onClick={onOpenApps}
            className="nav-btn nav-ghost nav-btn-icon group"
            title="My saved apps"
            aria-label="My saved apps"
          >
            <FolderOpen size={16} className="text-slate-500 group-hover:text-slate-900 transition-colors" />
            <span>Apps</span>
            {savedAppsCount > 0 && <span className="nav-count">{savedAppsCount}</span>}
          </button>

          <button
            data-tour="history"
            onClick={onToggleHistory}
            className={`nav-btn nav-ghost nav-btn-icon ${isHistoryOpen ? 'nav-ghost-active' : ''} group`}
            title={isHistoryOpen ? "Hide history drawer" : "Show history drawer"}
            aria-label={isHistoryOpen ? "Hide history drawer" : "Show history drawer"}
          >
            {isHistoryOpen ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} className="text-slate-500 group-hover:text-slate-900 transition-colors" />
            )}
            <span>History</span>
            {versionsCount > 0 && <span className="nav-dot" aria-hidden="true" />}
          </button>
        </div>

        {/* Rank 3: Environment -- workspace-level preferences and info */}
        <span className="nav-divider" aria-hidden="true" />
        <div className="nav-rank">
          <button
            data-tour="settings"
            onClick={onOpenSettings}
            className="nav-btn nav-ghost nav-btn-icon group"
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={16} className="text-slate-500 group-hover:text-slate-900 transition-colors" />
            <span className="hidden xl:inline">Settings</span>
          </button>

          {/* Label held back to xl so the lg row keeps room for the account. */}
          <button
            data-tour="help"
            onClick={onOpenHelp}
            className="nav-btn nav-ghost nav-btn-icon group"
            title="How AppBlips works"
            aria-label="Help"
          >
            <CircleHelp size={16} className="text-slate-500 group-hover:text-slate-900 transition-colors" />
            <span className="hidden xl:inline">Help</span>
          </button>

          {/* Hosted mode + signed-in only, same gate as the account control */}
          {firebaseEnabled && isSignedIn && (
            <button
              onClick={onOpenAnalytics}
              className="nav-btn nav-ghost nav-btn-icon group"
              title="Analytics"
              aria-label="Analytics"
            >
              <BarChart3 size={16} className="text-slate-500 group-hover:text-slate-900 transition-colors" />
              <span className="hidden xl:inline">Analytics</span>
            </button>
          )}
        </div>

        {/* Rank 4: Account + theme */}
        <span className="nav-divider" aria-hidden="true" />
        <div className="nav-rank">
          {!firebaseEnabled ? null : isSignedIn ? (
            <button
              onClick={onOpenAccountSettings}
              className="nav-btn nav-ghost nav-btn-icon group"
              title={userEmail || 'Signed in'}
              aria-label="Account settings"
            >
              {userEmail ? (
                <span className="h-5 w-5 rounded-full brand-gradient text-[10px] font-bold flex items-center justify-center shadow-2xs">
                  {(userEmail[0] || '?').toUpperCase()}
                </span>
              ) : (
                <UserRound size={16} className="text-slate-500 group-hover:text-slate-900 transition-colors" />
              )}
              <span className="hidden xl:inline max-w-[10rem] truncate">{userEmail || 'Account'}</span>
            </button>
          ) : authStatus !== 'loading' ? (
            <button
              onClick={onSignIn}
              className="nav-btn nav-ghost nav-btn-icon group"
              title="Sign in to your account"
              aria-label="Sign in to your account"
            >
              <LogIn size={16} className="text-slate-500 group-hover:text-slate-900 transition-colors" />
              <span className="hidden xl:inline">Sign in</span>
            </button>
          ) : null}

          {/* Theme toggle -- the icon names the destination, not the current state */}
          <button
            onClick={onToggleTheme}
            className="nav-btn nav-ghost nav-btn-icon group"
            title={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {resolvedTheme === 'dark' ? (
              <Sun size={16} className="group-hover:text-slate-900 transition-colors" />
            ) : (
              <Moon size={16} className="group-hover:text-slate-900 transition-colors" />
            )}
          </button>
        </div>
      </nav>

      <div className="lg:hidden relative shrink-0">
        <button
          type="button"
          ref={triggerRef}
          data-tour="menu"
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          className="nav-btn nav-btn-icon header-menu-key"
          title={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isMobileMenuOpen}
          aria-controls="mobile-header-menu"
        >
          {/* No text-* class: .header-menu-key owns the icon color so the key
              can brighten as a whole on hover. */}
          {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {createPortal(
          <div className="mobile-menu-layer dark force-dark lg:hidden">
          <button
            type="button"
            className={`mobile-menu-backdrop fixed inset-0 z-40 cursor-default bg-black/20 transition-opacity duration-300 ease-out ${isMobileMenuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            aria-hidden="true"
            tabIndex={-1}
            onClick={closeMobileMenu}
          />
          <div
            ref={menuRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            inert={!isMobileMenuOpen}
            id="mobile-header-menu"
            className={`mobile-side-menu ${isMobileMenuOpen ? 'mobile-side-menu-open' : ''}`}
            aria-hidden={!isMobileMenuOpen}
          >
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <span className="text-sm font-semibold text-slate-100">Menu</span>
                <button
                  type="button"
                  onClick={closeMobileMenu}
                  className="nav-btn nav-btn-secondary nav-btn-icon group"
                  title="Close menu"
                  aria-label="Close menu"
                >
                  <X size={18} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
                </button>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label="Studio mode">
                <button
                  type="button"
                  onClick={() => runMobileAction(() => onStudioModeChange('app'))}
                  aria-pressed={studioMode === 'app'}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                    studioMode === 'app'
                      ? 'bg-indigo-500 text-white shadow-md'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <Smartphone size={16} />
                  <span>App Studio</span>
                </button>
                <button
                  type="button"
                  onClick={() => runMobileAction(() => onStudioModeChange('website'))}
                  aria-pressed={studioMode === 'website'}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                    studioMode === 'website'
                      ? 'bg-indigo-500 text-white shadow-md'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <Globe size={16} />
                  <span>Website Studio</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => runMobileAction(onNewApp)}
                className="mobile-menu-item mobile-menu-item-primary group"
              >
          <Plus size={16} strokeWidth={2.4} />
                <span>New {STUDIO_MODES[studioMode]?.label || 'App'}</span>
              </button>
              <button
                type="button"
                data-tour="apps"
                aria-label="Apps"
                onClick={() => runMobileAction(onOpenApps)}
                className="mobile-menu-item"
              >
                <FolderOpen size={16} />
                <span>Apps</span>
                {savedAppsCount > 0 && <span className="mobile-menu-count">{savedAppsCount}</span>}
              </button>
              <button
                type="button"
                aria-label="History"
                onClick={() => runMobileAction(onToggleHistory)}
                className="mobile-menu-item"
                aria-expanded={isHistoryOpen}
              >
                <PanelLeftOpen size={16} />
                <span>History</span>
                {versionsCount > 0 && <span className="mobile-menu-count">{versionsCount}</span>}
              </button>
              <button
                type="button"
                data-tour="settings"
                onClick={() => runMobileAction(onOpenSettings)}
                className="mobile-menu-item"
              >
                <Settings size={16} />
                <span>Settings</span>
              </button>
              <button
                type="button"
                data-tour="help"
                onClick={() => runMobileAction(onOpenHelp)}
                className="mobile-menu-item"
              >
                <CircleHelp size={16} />
                <span>Help</span>
              </button>
              {firebaseEnabled && isSignedIn && (
                <>
                  <button
                    type="button"
                    onClick={() => runMobileAction(onOpenAnalytics)}
                    className="mobile-menu-item"
                  >
                    <BarChart3 size={16} />
                    <span>Analytics</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runMobileAction(onOpenAccountSettings)}
                    className="mobile-menu-item"
                    title={userEmail || 'Signed in'}
                  >
                    <span className="h-5 w-5 rounded-full brand-gradient text-white text-[10px] font-bold flex items-center justify-center shadow-2xs">
                      {(userEmail?.[0] || '?').toUpperCase()}
                    </span>
                    <span className="truncate">{userEmail || 'Account'}</span>
                  </button>
                </>
              )}
              {firebaseEnabled && !isSignedIn && authStatus !== 'loading' && (
                <button
                  type="button"
                  onClick={() => runMobileAction(onSignIn)}
                  className="mobile-menu-item"
                >
                  <LogIn size={16} />
                  <span>Sign in</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => runMobileAction(onToggleTheme)}
                className="mobile-menu-item"
              >
                {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                <span>{resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
              </button>
          </div>
          </div>, document.body
        )}
      </div>
    </header>
  );
}
