import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, DoorOpen, FolderOpen, PanelLeftClose, PanelLeftOpen, Sun, Moon,
  Settings, CircleHelp, LogIn, BarChart3, Menu, X, UserRound
} from 'lucide-react';
import { STUDIO_MODES } from '../lib/constants';
import { SHORTCUT_HINTS } from '../lib/shortcuts';
import { DOCS_URL } from '../lib/constants';



// Top bar: brand + current-app pill on the left; studio switch, New App /
// Apps / History / Settings / Help / auth / theme on the right.
export default function Header({
  projectName,
  onNewApp,
  onExit,
  savedAppsCount,
  versionsCount,
  onOpenApps,
  isHistoryOpen,
  onToggleHistory,
  resolvedTheme,
  onToggleTheme,
  onOpenSettings,
  authStatus,
  isSignedIn,
  userEmail,
  onOpenAccountSettings,
  onSignIn,
  firebaseEnabled,
  onOpenAnalytics,
  studioMode = 'app',
  mobileView,
  onMobileViewChange,
  onNewChat,
  canNewChat = false,
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
  // Local part only: the strip has to hold four ranks, and the domain is the
  // half of an address that never disambiguates anything.
  const accountLabel = userEmail ? userEmail.split('@')[0] : 'Account';

  return (
    <header className="app-header dark force-dark shrink-0 bg-surface/95 backdrop-blur-md border-b border-slate-200 header-shadow px-3 sm:px-5 2xl:px-8 flex items-center justify-between gap-2 sm:gap-3 sticky top-0 z-40 transition-colors">
      {/* Left: Brand lockup, then the current-app nameplate */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onNewApp}
          className="header-logo-btn shrink-0 flex items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          data-tip="Back to the studio picker"
          aria-label="Back to the studio picker"
        >
          <img src="/appblips-logo.png" alt="AppBlips" className="h-9 w-auto object-contain" />
        </button>
        <span className="chrome-divider" aria-hidden="true" />
        <div
          className={`nav-nameplate max-w-[160px] xl:max-w-[300px] 2xl:max-w-[420px] ${hasProjectName ? 'text-slate-900' : 'text-slate-500'}`}
          data-tip={hasProjectName ? `Current ${article}: ${projectName}` : untitledName}
        >
          {hasProjectName && <span className="nav-nameplate-dot" aria-hidden="true" />}
          <span className="truncate">{displayName}</span>
        </div>
      </div>

      {/* Below lg the workspace is one pane at a time, so the Chat/Preview
          switch rides in the header rather than costing a band of its own.
          Hidden at lg and up, where both panes are on screen together. */}
      {onMobileViewChange && (
        <div
          className="header-view-switch nav-segmented-group nav-segmented-compact min-w-0 flex-1 max-w-56"
          role="group"
          aria-label="Workspace view"
        >
          <button
            type="button"
            onClick={() => onMobileViewChange('chat')}
            aria-pressed={mobileView === 'chat'}
            className={`nav-segmented-btn flex-1 text-xs uppercase tracking-wider font-bold ${mobileView === 'chat' ? 'nav-segmented-btn-active' : ''}`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => onMobileViewChange('preview')}
            aria-pressed={mobileView === 'preview'}
            className={`nav-segmented-btn flex-1 text-xs uppercase tracking-wider font-bold ${mobileView === 'preview' ? 'nav-segmented-btn-active' : ''}`}
          >
            Preview
          </button>
        </div>
      )}

      {/* The build panel's own header is suppressed below lg (it held only this
          one key), so the new-chat action moves up here beside the menu. */}
      {canNewChat && onNewChat && (
        <button
          type="button"
          onClick={onNewChat}
          className="nav-btn nav-btn-icon header-new-chat-key shrink-0"
          data-tip="New chat (keeps version history)"
          aria-label="New chat (keeps version history)"
        >
          <Plus size={20} strokeWidth={2.6} aria-hidden="true" />
        </button>
      )}

      {/* Right: a ranked control strip -- one solid key, workspace controls,
          environment controls, then account/theme, split by hairlines. */}
      <nav className="hidden lg:flex items-center gap-3 shrink-0" aria-label="Workspace actions">
        {/* Rank 1: Primary Action. The studio is chosen on the choice screen
            (forced on a fresh session, re-asked by "New") and remembered per
            project -- it is never switched while a workspace is open. */}
        <button
          onClick={onNewApp}
          className="nav-btn nav-btn-primary group"
          data-tip="Start something new"
          aria-label="Start something new"
        >
          <Plus size={16} strokeWidth={2.4} />
          <span>New</span>
        </button>

        {/* Rank 2: Workspace -- the app you are building */}
        <span className="chrome-divider" aria-hidden="true" />
        <div className="nav-rank">
          <button
            data-tour="apps"
            onClick={onOpenApps}
            className="nav-btn nav-ghost nav-btn-icon"
            data-tip="My saved apps"
            data-tip-key={SHORTCUT_HINTS.apps}
            aria-label="My saved apps"
          >
            <FolderOpen size={16} />
            <span>Apps</span>
            {savedAppsCount > 0 && <span className="nav-count">{savedAppsCount}</span>}
          </button>

          <button
            data-tour="history"
            onClick={onToggleHistory}
            aria-pressed={isHistoryOpen}
            className={`nav-btn nav-ghost nav-btn-icon ${isHistoryOpen ? 'nav-ghost-active' : ''}`}
            data-tip={isHistoryOpen ? "Hide history drawer" : "Show history drawer"}
            aria-label={isHistoryOpen ? "Hide history drawer" : "Show history drawer"}
          >
            {isHistoryOpen ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
            <span>History</span>
            {versionsCount > 0 && <span className="nav-dot" aria-hidden="true" />}
          </button>
        </div>

        {/* Rank 3: Environment -- workspace-level preferences and info */}
        <span className="chrome-divider" aria-hidden="true" />
        <div className="nav-rank">
          <button
            data-tour="settings"
            onClick={onOpenSettings}
            className="nav-btn nav-ghost nav-btn-icon"
            data-tip="Settings"
            aria-label="Settings"
          >
            <Settings size={16} />
            <span className="hidden xl:inline">Settings</span>
          </button>

          {/* Label held back to xl so the lg row keeps room for the account. */}
          <a
            data-tour="help"
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-btn nav-ghost nav-btn-icon"
            data-tip="Open the AppBlips docs"
            data-tip-key={SHORTCUT_HINTS.help}
            aria-label="Help"
          >
            <CircleHelp size={16} />
            <span className="hidden xl:inline">Help</span>
          </a>

          {/* Hosted mode + signed-in only, same gate as the account control */}
          {firebaseEnabled && isSignedIn && (
            <button
              onClick={onOpenAnalytics}
              className="nav-btn nav-ghost nav-btn-icon"
              data-tip="Analytics"
              aria-label="Analytics"
            >
              <BarChart3 size={16} />
              <span className="hidden xl:inline">Analytics</span>
            </button>
          )}
        </div>

        {/* Rank 4: Account + theme */}
        <span className="chrome-divider" aria-hidden="true" />
        <div className="nav-rank">
          {!firebaseEnabled ? null : isSignedIn ? (
            <button
              onClick={onOpenAccountSettings}
              className="nav-btn nav-ghost nav-btn-icon"
              data-tip={userEmail || 'Signed in'}
              aria-label="Account settings"
            >
              {userEmail ? (
                <span className="h-5 w-5 rounded-full brand-gradient text-[10px] font-bold flex items-center justify-center shadow-2xs">
                  {(userEmail[0] || '?').toUpperCase()}
                </span>
              ) : (
                <UserRound size={16} />
              )}
              <span className="hidden 2xl:inline max-w-[9rem] truncate">{accountLabel}</span>
            </button>
          ) : authStatus !== 'loading' ? (
            <button
              onClick={onSignIn}
              className="nav-btn nav-ghost nav-btn-icon"
              data-tip="Sign in to your account"
              aria-label="Sign in to your account"
            >
              <LogIn size={16} />
              <span className="hidden xl:inline">Sign in</span>
            </button>
          ) : null}

          {/* Theme toggle -- the icon names the destination, not the current state */}
          <button
            onClick={onToggleTheme}
            className="nav-btn nav-ghost nav-btn-icon"
            data-tip={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {resolvedTheme === 'dark' ? (
              <Sun size={16} />
            ) : (
              <Moon size={16} />
            )}
          </button>

          <button
            onClick={onExit}
            className="nav-btn nav-ghost nav-btn-icon"
            data-tip="Exit to the studio picker (app or website)"
            aria-label="Exit to the studio picker"
          >
            <DoorOpen size={16} />
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
          data-tip={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
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
                  className="nav-btn nav-btn-secondary nav-btn-icon"
                  title="Close menu"
                  aria-label="Close menu"
                >
                  <X size={18} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => runMobileAction(onNewApp)}
                className="mobile-menu-item mobile-menu-item-primary group"
              >
          <Plus size={16} strokeWidth={2.4} />
                <span>New</span>
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
              <a
                data-tour="help"
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => runMobileAction()}
                className="mobile-menu-item"
              >
                <CircleHelp size={16} />
                <span>Help</span>
              </a>
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
              <button
                type="button"
                aria-label="Exit to the studio picker"
                onClick={() => runMobileAction(onExit)}
                className="mobile-menu-item"
              >
                <DoorOpen size={16} />
                <span>Exit</span>
              </button>
          </div>
          </div>, document.body
        )}
      </div>
    </header>
  );
}
