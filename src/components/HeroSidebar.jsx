import { useEffect, useState } from 'react';
import {
  Plus, FolderOpen, PanelLeftClose, PanelLeftOpen, Settings,
  CircleHelp, Plug, Menu, X, Github, ShieldCheck, ScrollText,
} from 'lucide-react';
import { DOCS_URL, GITHUB_URL, DISCORD_URL } from '../lib/constants';
import { DiscordIcon } from './StudioChoice';

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
      <a href={href} draggable={false} target="_blank" rel="noopener noreferrer" className={className} aria-label={label} {...tip}>
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
  onOpenExtensions,
}) {
  const recentProjects = recents.slice(0, MAX_RECENTS);

  // Slide-out menu below lg, the same one the studio picker uses below md.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);
  // Closes first so a modal (Settings, Saved apps) doesn't open over the panel.
  const fromMenu = (fn) => () => { setMenuOpen(false); fn?.(); };

  return (
    <>
    <aside
      className={`hero-rail shrink-0 flex flex-row lg:flex-col items-center lg:items-stretch gap-1 px-2 py-2 lg:px-2.5 lg:py-3 ${collapsed ? 'lg:w-15' : 'lg:w-56'}`}
      aria-label="Studio navigation"
    >
      <div className={`hero-rail-brand flex items-center gap-2 px-1.5 lg:pb-2 ${collapsed ? 'lg:flex-col lg:gap-3' : 'lg:justify-between'}`}>
        <span className="flex items-center gap-2 min-w-0">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />
          {/* Same two wordmarks as the studio picker (one shows per theme). Hidden only when the desktop rail is collapsed to icons. */}
          <img src="/appblips-wordmark-dark.svg" alt="AppBlips" className={`hero-rail-wordmark-img studio-logo-dark ${collapsed ? 'lg:hidden' : ''}`} />
          <img src="/appblips-wordmark-light.svg" alt="" aria-hidden="true" className={`hero-rail-wordmark-img studio-logo-light ${collapsed ? 'lg:hidden' : ''}`} />
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

      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        className="hero-menu-btn ml-auto lg:hidden"
        aria-label="Open menu"
        aria-expanded={menuOpen}
        aria-controls="hero-mobile-menu"
      >
        <Menu size={18} aria-hidden="true" />
      </button>

      <nav className="hidden lg:flex flex-col items-stretch gap-1 lg:flex-1 min-h-0" aria-label="Studio actions">
        <RailItem icon={Plus} label="New" collapsed={collapsed} onClick={onNewApp} primary />
        <RailItem
          icon={FolderOpen}
          label="Saved apps"
          collapsed={collapsed}
          onClick={onOpenApps}
          badge={savedAppsCount > 0 ? (
            <span className={`hero-rail-count hidden ${collapsed ? '' : 'lg:inline-flex'}`}>{savedAppsCount}</span>
          ) : null}
        />
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

        <RailItem icon={Plug} label="Extensions" collapsed={collapsed} onClick={onOpenExtensions} />
        <RailItem icon={Settings} label="Settings" collapsed={collapsed} onClick={onOpenSettings} />
        <RailItem icon={CircleHelp} label="Help" collapsed={collapsed} href={DOCS_URL} />
      </nav>
    </aside>

    {/* Mobile slide-out menu (below lg). Always mounted so it can animate;
        `inert` keeps the closed panel out of tab order. Reuses the studio
        picker's panel styles (studio-choice.css). */}
    <div className="hero-menu lg:hidden" data-open={menuOpen}>
      <div className="studio-menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <aside id="hero-mobile-menu" className="studio-menu-panel" aria-label="Menu" inert={!menuOpen}>
        <div className="studio-menu-head">
          <span className="text-sm font-semibold">Menu</span>
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="hero-menu-btn">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="studio-menu-list">
          <button type="button" className="studio-menu-item" onClick={fromMenu(onNewApp)}>
            <Plus size={18} aria-hidden="true" /> New
          </button>
          <button type="button" className="studio-menu-item" onClick={fromMenu(onOpenApps)}>
            <FolderOpen size={18} aria-hidden="true" /> Saved apps{savedAppsCount > 0 ? ` (${savedAppsCount})` : ''}
          </button>
          {recentProjects.length > 0 && (
            <>
              <div className="studio-menu-sep" role="separator" />
              <p className="hero-rail-heading">Recents</p>
              {recentProjects.map((project) => (
                <button key={project.id} type="button" className="studio-menu-item" onClick={fromMenu(() => onLoadProject?.(project))}>
                  <span className="truncate">{project.name}</span>
                </button>
              ))}
            </>
          )}
          <div className="studio-menu-sep" role="separator" />
          <button type="button" className="studio-menu-item" onClick={fromMenu(onOpenExtensions)}>
            <Plug size={18} aria-hidden="true" /> Extensions
          </button>
          <button type="button" className="studio-menu-item" onClick={fromMenu(onOpenSettings)}>
            <Settings size={18} aria-hidden="true" /> Settings
          </button>
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="studio-menu-item" onClick={fromMenu()}>
            <CircleHelp size={18} aria-hidden="true" /> Help
          </a>
          <div className="studio-menu-sep" role="separator" />
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="studio-menu-item" onClick={fromMenu()}>
            <Github size={18} aria-hidden="true" /> GitHub
          </a>
          <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="studio-menu-item" onClick={fromMenu()}>
            <DiscordIcon size={18} /> Discord
          </a>
          <div className="studio-menu-sep" role="separator" />
          <a href="https://www.appblips.com/privacy" target="_blank" rel="noopener noreferrer" className="studio-menu-item" onClick={fromMenu()}>
            <ShieldCheck size={18} aria-hidden="true" /> Privacy Policy
          </a>
          <a href="https://www.appblips.com/terms" target="_blank" rel="noopener noreferrer" className="studio-menu-item" onClick={fromMenu()}>
            <ScrollText size={18} aria-hidden="true" /> Terms of Service
          </a>
        </div>
      </aside>
    </div>
    </>
  );
}
