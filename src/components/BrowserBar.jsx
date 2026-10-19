import { ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, Square } from 'lucide-react';

// The project's name where a web address would be. Pages are switched with
// the page picker in the preview toolbar, so there is nothing to type here.
function BrowserTitle({ title }) {
  return (
    <div className="browser-address browser-title" title={title}>
      <Globe size={14} aria-hidden="true" />
      <span>{title}</span>
    </div>
  );
}

// Imported codebases are one-page React apps: the address is the client
// route the router shim last reported, and entering one rebuilds the preview
// starting there.
function RouteAddress({ route, onNavigateRoute, disabled }) {
  return (
    <form className="browser-address" onSubmit={(event) => {
      event.preventDefault();
      const address = new FormData(event.currentTarget).get('address').trim();
      const path = address.replace(/^(?:https?:\/\/)?appblips\.local/i, '');
      onNavigateRoute(path.startsWith('/') ? path : `/${path}`);
    }}>
      <Globe size={14} aria-hidden="true" />
      <input name="address" aria-label="Site address" defaultValue={`appblips.local${route}`} disabled={disabled} autoComplete="off" spellCheck="false" />
    </form>
  );
}

export default function BrowserBar({ title, hasCode, navState, onBack, onForward,
  onReload, isTesting, status, onStop, route = null, onNavigateRoute = null }) {
  return (
    <div className="embedded-browser-bar" aria-label="Browser navigation">
      <div className="browser-navigation">
        <button type="button" className="nav-btn nav-ghost nav-btn-icon" aria-label="Browser back" disabled={!navState?.canGoBack || isTesting} onClick={onBack}><ArrowLeft size={16} /></button>
        <button type="button" className="nav-btn nav-ghost nav-btn-icon" aria-label="Browser forward" disabled={!navState?.canGoForward || isTesting} onClick={onForward}><ArrowRight size={16} /></button>
        <button type="button" className="nav-btn nav-ghost nav-btn-icon" aria-label="Reload browser" disabled={!hasCode || isTesting} onClick={onReload}><RotateCw size={15} /></button>
      </div>
      {onNavigateRoute
        ? <RouteAddress key={route} route={route || '/'} onNavigateRoute={onNavigateRoute} disabled={!hasCode || isTesting} />
        : <BrowserTitle title={title} />}
      {isTesting && (
        <div className="browser-testing-status" role="status">
          <Loader2 size={14} className="animate-spin" />
          <span>{status || 'Testing in browser…'}</span>
          <button type="button" className="nav-btn nav-ghost nav-btn-icon" aria-label="Stop browser testing" onClick={onStop}><Square size={13} /></button>
        </div>
      )}
    </div>
  );
}
