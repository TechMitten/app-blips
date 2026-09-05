import {
  Plus, FolderOpen, PanelLeftClose, PanelLeftOpen, Sun, Moon,
  Settings, LogIn
} from 'lucide-react';


// Top bar: brand + current-app pill on the left; New App / Apps / History /
// theme / Settings / auth on the right.
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
  authStatus,
  isSignedIn,
  userEmail,
  onOpenAccountSettings,
  onSignIn,
  firebaseEnabled,
}) {
  return (
    <header className="dark force-dark shrink-0 bg-surface/95 backdrop-blur-md border-b border-slate-200 header-shadow px-2 sm:px-6 2xl:px-8 py-2.5 2xl:py-3 flex items-center justify-between gap-1.5 sm:gap-3 sticky top-0 z-40 transition-colors">
      {/* Left: Brand / Logo */}
      <div className="flex items-center gap-2.5 shrink-0 min-w-0">
        <img src="/appblips-logo.png" alt="AppBlips" className="h-20 2xl:h-24 w-auto object-contain -my-4 -ml-2" />
        <div className="flex items-center gap-2.5 min-w-0">
          {projectName && projectName !== 'Untitled App' && (
            <div
              className="hidden md:flex items-center gap-1.5 px-2.5 py-0.5 2xl:px-3 2xl:py-1 rounded-full bg-slate-100/90 border border-slate-200/70 text-xs 2xl:text-sm font-semibold text-slate-700 max-w-[160px] xl:max-w-[300px] 2xl:max-w-[400px] truncate"
              title={`Current App: ${projectName}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
              <span className="truncate">{projectName}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right: Actions and Controls */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* Primary Action: New App */}
        <button
          onClick={onNewApp}
          className="nav-btn nav-btn-primary group"
          title="Start a new app"
          aria-label="Start a new app"
        >
          <Plus size={15} strokeWidth={2.4} className="group-hover:rotate-90 transition-transform duration-200" />
          <span className="hidden sm:inline">New App</span>
        </button>

        {/* Apps Modal Trigger */}
        <button
          onClick={onOpenApps}
          className="nav-btn nav-btn-secondary nav-btn-icon group"
          title="My Saved Apps"
          aria-label="My saved apps"
        >
          <FolderOpen size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
          <span className="hidden lg:inline">Apps</span>
          {savedAppsCount > 0 && (
            <span className="hidden lg:inline-flex items-center justify-center px-1.5 py-0.2 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
              {savedAppsCount}
            </span>
          )}
        </button>

        {/* History Panel Toggle */}
        <button
          onClick={onToggleHistory}
          className={`nav-btn nav-btn-icon nav-btn-history ${isHistoryOpen ? 'nav-btn-secondary-active' : 'nav-btn-secondary'} group`}
          title={isHistoryOpen ? "Hide history drawer" : "Show history drawer"}
          aria-label={isHistoryOpen ? "Hide history drawer" : "Show history drawer"}
        >
          {isHistoryOpen ? (
            <PanelLeftClose size={15} className="text-indigo-600" />
          ) : (
            <PanelLeftOpen size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
          )}
          <span className="hidden lg:inline">History</span>
          {versionsCount > 0 && (
            <span className={`w-1.5 h-1.5 rounded-full transition-colors ${isHistoryOpen ? 'bg-indigo-600' : 'bg-slate-400 group-hover:bg-indigo-500'}`} />
          )}
        </button>

        {/* Theme Toggle -- the icon names the destination, not the current state */}
        <button
          onClick={onToggleTheme}
          className="nav-btn nav-btn-secondary nav-btn-icon group hidden sm:flex"
          title={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {resolvedTheme === 'dark' ? (
            <Sun size={15} className="text-slate-500 group-hover:text-indigo-600 group-hover:rotate-45 transition-all duration-300" />
          ) : (
            <Moon size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
          )}
        </button>

        {/* Settings Modal Trigger */}
        <button
          onClick={onOpenSettings}
          className="nav-btn nav-btn-secondary nav-btn-icon group"
          title="Settings"
          aria-label="Settings"
        >
          <Settings size={15} className="text-slate-500 group-hover:text-indigo-600 group-hover:rotate-45 transition-all duration-300" />
          <span className="hidden lg:inline">Settings</span>
        </button>

        {/* Auth Section -- hidden entirely in self-hosted mode, no accounts to sign into */}
        {!firebaseEnabled ? null : isSignedIn ? (
          <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-slate-200/80 max-[400px]:ml-0 max-[400px]:pl-0 max-[400px]:border-0">
            <button
              onClick={onOpenAccountSettings}
              className="flex items-center gap-2 min-h-9 min-w-9 px-1.5 lg:pl-1.5 lg:pr-3 py-1 rounded-full bg-slate-100/90 hover:bg-slate-200/90 border border-slate-200/70 hover:border-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
              title={userEmail || 'Signed in'}
              aria-label="Account settings"
            >
              <span className="h-5 w-5 rounded-full brand-gradient text-white text-[10px] font-bold flex items-center justify-center shadow-2xs">
                {(userEmail?.[0] || '?').toUpperCase()}
              </span>
              <span className="hidden lg:inline max-w-[6rem] xl:max-w-[10rem] truncate">{userEmail}</span>
            </button>
          </div>
        ) : authStatus !== 'loading' ? (
          <div className="flex items-center ml-1 pl-2 border-l border-slate-200/80 max-[400px]:ml-0 max-[400px]:pl-0 max-[400px]:border-0">
            <button
              onClick={onSignIn}
              className="nav-btn nav-btn-secondary nav-btn-icon group hover:text-indigo-600 hover:border-indigo-200"
              title="Sign in to your account"
              aria-label="Sign in to your account"
            >
              <LogIn size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
              <span className="hidden lg:inline">Sign in</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
