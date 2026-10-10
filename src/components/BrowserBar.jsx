import { useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, Square } from 'lucide-react';
import { resolvePageLink } from '../lib/pages';

function BrowserAddress({ activePage, pages, onSelectPage, disabled }) {
  const [error, setError] = useState('');
  return (
    <form className="browser-address" onSubmit={(event) => {
      event.preventDefault();
      const address = new FormData(event.currentTarget).get('address').trim();
      const path = address.replace(/^(?:https?:\/\/)?appblips\.local\/?/i, '');
      const page = resolvePageLink(path || 'index.html');
      if (!page || !pages.includes(page)) { setError('Enter a page from this project.'); return; }
      setError('');
      onSelectPage(page);
    }}>
      <Globe size={14} aria-hidden="true" />
      <input name="address" aria-label="Project page address" defaultValue={`appblips.local/${activePage}`} disabled={disabled} autoComplete="off" spellCheck="false" onChange={() => setError('')} />
      {error && <span className="browser-address-error" role="alert">{error}</span>}
    </form>
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

export default function BrowserBar({ activePage, pages, onSelectPage, hasCode, navState, onBack, onForward,
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
        : <BrowserAddress key={activePage} {...{ activePage, pages, onSelectPage }} disabled={!hasCode || isTesting} />}
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
