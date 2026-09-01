import {
  Plus, FolderOpen, PanelLeftClose, PanelLeftOpen, Sun, Moon,
  Settings, LogIn, LogOut
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
  onSignOut,
}) {
  return (
    <header className="shrink-0 bg-surface/95 backdrop-blur-md border-b border-slate-200/80 header-shadow px-4 sm:px-6 2xl:px-8 py-2.5 2xl:py-3 flex items-center justify-between sticky top-0 z-40">
      {/* Left: Brand / Logo */}
      <div className="flex items-center gap-2.5">
        <img
          src="/orionlogo.png"
          alt="Orion logo"
          className="w-10 h-10 2xl:w-11 2xl:h-11 rounded-xl shadow-xs shadow-indigo-500/25 ring-1 ring-indigo-500/20"
        />
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl 2xl:text-3xl leading-[2.5rem] 2xl:leading-[2.75rem] font-bold text-slate-900 tracking-tight font-sans">Orion</h1>
          {projectName && projectName !== 'Untitled App' && (
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 2xl:px-3 2xl:py-1 rounded-full bg-slate-100/90 border border-slate-200/70 text-xs 2xl:text-sm font-semibold text-slate-700 max-w-[200px] xl:max-w-[300px] 2xl:max-w-[400px] truncate"
              title={`Current App: ${projectName}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
              <span className="truncate">{projectName}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right: Actions and Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Primary Action: New App */}
        <button
          onClick={onNewApp}
          className="nav-btn nav-btn-primary group"
          title="Start a new app"
        >
          <Plus size={15} strokeWidth={2.4} className="group-hover:rotate-90 transition-transform duration-200" />
          <span className="hidden sm:inline">New App</span>
          <span className="sm:hidden">New</span>
        </button>

        {/* Apps Modal Trigger */}
        <button
          onClick={onOpenApps}
          className="nav-btn nav-btn-secondary group"
          title="My Saved Apps"
        >
          <FolderOpen size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
          <span className="hidden sm:inline">Apps</span>
          {savedAppsCount > 0 && (
            <span className="hidden md:inline-flex items-center justify-center px-1.5 py-0.2 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
              {savedAppsCount}
            </span>
          )}
        </button>

        {/* History Panel Toggle */}
        <button
          onClick={onToggleHistory}
          className={`nav-btn ${isHistoryOpen ? 'nav-btn-secondary-active' : 'nav-btn-secondary'} group`}
          title={isHistoryOpen ? "Hide history drawer" : "Show history drawer"}
        >
          {isHistoryOpen ? (
            <PanelLeftClose size={15} className="text-indigo-600" />
          ) : (
            <PanelLeftOpen size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
          )}
          <span className="hidden sm:inline">History</span>
          {versionsCount > 0 && (
            <span className={`w-1.5 h-1.5 rounded-full transition-colors ${isHistoryOpen ? 'bg-indigo-600' : 'bg-slate-400 group-hover:bg-indigo-500'}`} />
          )}
        </button>

        {/* Theme Toggle -- the icon names the destination, not the current state */}
        <button
          onClick={onToggleTheme}
          className="nav-btn nav-btn-secondary nav-segmented-btn-icon group"
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
          className="nav-btn nav-btn-secondary group"
          title="Settings"
        >
          <Settings size={15} className="text-slate-500 group-hover:text-indigo-600 group-hover:rotate-45 transition-all duration-300" />
          <span className="hidden sm:inline">Settings</span>
        </button>

        {/* Auth Section */}
        {isSignedIn ? (
          <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-slate-200/80">
            <button
              onClick={onOpenAccountSettings}
              className="hidden md:inline-flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full bg-slate-100/90 hover:bg-slate-200/90 border border-slate-200/70 hover:border-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
              title={userEmail || 'Signed in'}
            >
              <span className="h-5 w-5 rounded-full brand-gradient text-white text-[10px] font-bold flex items-center justify-center shadow-2xs">
                {(userEmail?.[0] || '?').toUpperCase()}
              </span>
              <span className="max-w-[10rem] truncate">{userEmail}</span>
            </button>
            <button
              onClick={onSignOut}
              className="nav-btn bg-surface hover:bg-rose-50/80 text-slate-500 hover:text-rose-600 border border-slate-200/80 hover:border-rose-200/80 text-xs group"
              title="Sign out"
            >
              <LogOut size={14} className="text-slate-400 group-hover:text-rose-500 transition-colors" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        ) : authStatus !== 'loading' ? (
          <div className="flex items-center ml-1 pl-2 border-l border-slate-200/80">
            <button
              onClick={onSignIn}
              className="nav-btn nav-btn-secondary group hover:text-indigo-600 hover:border-indigo-200"
              title="Sign in to your account"
            >
              <LogIn size={15} className="text-slate-500 group-hover:text-indigo-600 transition-colors" />
              <span className="hidden sm:inline">Sign in</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
