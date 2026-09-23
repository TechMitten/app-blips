import {
  Plus, FolderOpen, PanelLeftClose, PanelLeftOpen, Settings,
  CircleHelp, LogIn, BarChart3, UserRound,
} from 'lucide-react';
import { DOCS_URL } from '../lib/constants';

const MAX_RECENTS = 5;

// Side rail for the first-build screen. Every entry maps to an action Header
// already exposes, so this is a second front door to the same handlers, not
// new behavior. Expanded (icon + label, plus a Recents list) or collapsed to an
// icon-only strip; below `lg` it folds into a compact top bar of icon keys.
function RailItem({ icon: Icon, label, collapsed, onClick, href, badge = null, primary = false, active = false }) {
  const className = `hero-rail-item${primary ? ' hero-rail-item-primary' : ''}${active ? ' hero-rail-item-active' : ''}${collapsed ? ' is-collapsed' : ''}`;
  const content = (
    <>
      <Icon size={17} aria-hidden="true" className="shrink-0" />
      <span className={`hero-rail-label hidden ${collapsed ? '' : 'lg:inline'}`}>{label}</span>
      {badge}
    </>
  );
  // The tooltip only earns its place when the label is hidden.
  const tip = { 'data-tip': label, 'data-tip-side': 'right' };
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={label} {...tip}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} aria-label={label} {...tip}>
      {content}
    </button>
  );
}

export default function HeroSidebar({
  collapsed,
  onToggleCollapsed,
  onNewApp,
  onOpenApps,
  savedAppsCount = 0,
  recents = [],
  onLoadProject,
  onOpenSettings,
  firebaseEnabled,
  isSignedIn,
  authStatus,
  userEmail,
  onOpenAnalytics,
  onOpenAccountSettings,
  onSignIn,
}) {
  const recentProjects = recents.slice(0, MAX_RECENTS);

  return (
    <aside
      className={`hero-rail shrink-0 flex flex-row lg:flex-col items-center lg:items-stretch gap-1 px-2 py-2 lg:px-2.5 lg:py-3 ${collapsed ? 'lg:w-[3.75rem]' : 'lg:w-56'}`}
      aria-label="Studio navigation"
    >
      <div className={`hero-rail-brand flex items-center gap-2 px-1.5 lg:pb-2 ${collapsed ? 'lg:flex-col lg:gap-3' : 'lg:justify-between'}`}>
        <span className="flex items-center gap-2 min-w-0">
          <span className="hero-blips" aria-hidden="true">
            <span className="hero-blip hero-blip-cyan" />
            <span className="hero-blip hero-blip-brand" />
            <span className="hero-blip hero-blip-coral" />
          </span>
          <span className={`hero-rail-wordmark hidden ${collapsed ? '' : 'lg:inline'}`}>AppBlips</span>
        </span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="hero-rail-toggle hidden lg:inline-flex"
          aria-label={collapsed ? 'Expand side panel' : 'Collapse side panel'}
          aria-expanded={!collapsed}
          data-tip={collapsed ? 'Expand side panel' : 'Collapse side panel'}
          data-tip-side="right"
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
        </button>
      </div>

      <nav className="flex flex-row lg:flex-col items-center lg:items-stretch gap-1 ml-auto lg:ml-0 lg:flex-1 min-h-0" aria-label="Studio actions">
        <RailItem icon={Plus} label="New (pick a studio)" collapsed={collapsed} onClick={onNewApp} primary />
        <RailItem
          icon={FolderOpen}
          label="Saved apps"
          collapsed={collapsed}
          onClick={onOpenApps}
          badge={savedAppsCount > 0 ? (
            <span className={`hero-rail-count hidden ${collapsed ? '' : 'lg:inline-flex'}`}>{savedAppsCount}</span>
          ) : null}
        />
        {firebaseEnabled && isSignedIn && (
          <RailItem icon={BarChart3} label="Analytics" collapsed={collapsed} onClick={onOpenAnalytics} />
        )}

        {recentProjects.length > 0 && !collapsed && (
          <div className="hidden lg:flex flex-col gap-0.5 mt-4 min-h-0 overflow-y-auto">
            <p className="hero-rail-heading">Recents</p>
            {recentProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onLoadProject?.(project)}
                className="hero-rail-recent"
                title={project.name}
              >
                <span className="truncate">{project.name}</span>
              </button>
            ))}
          </div>
        )}

        <span className="hidden lg:block lg:flex-1" aria-hidden="true" />

        <RailItem icon={Settings} label="Settings" collapsed={collapsed} onClick={onOpenSettings} />
        <RailItem icon={CircleHelp} label="Help" collapsed={collapsed} href={DOCS_URL} />
        {!firebaseEnabled ? null : isSignedIn ? (
          <RailItem
            icon={UserRound}
            label={userEmail ? userEmail.split('@')[0] : 'Account'}
            collapsed={collapsed}
            onClick={onOpenAccountSettings}
          />
        ) : authStatus !== 'loading' ? (
          <RailItem icon={LogIn} label="Sign in" collapsed={collapsed} onClick={onSignIn} />
        ) : null}
      </nav>
    </aside>
  );
}
