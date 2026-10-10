// Source of the module the preview bundle uses in place of react-router /
// react-router-dom. The preview is an about:srcdoc document in an opaque
// origin, where BrowserRouter's history.pushState('/about') can't work, so
// browser routers become memory routers that start at the route the user was
// last on (rebuilds after every edit reload the frame) and report each
// navigation to the parent through the preview bridge. Everything else is
// re-exported untouched; HashRouter already works in srcdoc and is left alone.
// Only used in the preview bundle: exports keep the project's real imports.
export const ROUTER_PACKAGES = new Set(['react-router-dom', 'react-router']);

export function routerShimSource(spec) {
  const target = JSON.stringify(spec);
  return `import * as Real from ${target};
import { createElement, useEffect } from 'react';
export * from ${target};

const initialEntry = (basename) => {
  const route = (typeof window !== 'undefined' && window.__APPBLIPS_INITIAL_ROUTE__) || '/';
  return [basename && basename !== '/' ? basename.replace(/\\/$/, '') + route : route];
};
const report = (location) => {
  if (!location || typeof window === 'undefined') return;
  window.__appblipsReportRoute?.(location.pathname + (location.search || '') + (location.hash || ''));
};

function AppBlipsRouteBridge() {
  const location = Real.useLocation();
  const navigate = Real.useNavigate();
  useEffect(() => {
    window.__appblipsRouterNavigate = (to) => navigate(to);
    return () => { if (window.__appblipsRouterNavigate) delete window.__appblipsRouterNavigate; };
  }, [navigate]);
  useEffect(() => { report(location); }, [location]);
  return null;
}

export function BrowserRouter({ basename, children, future }) {
  return createElement(Real.MemoryRouter, { basename, future, initialEntries: initialEntry(basename) },
    createElement(AppBlipsRouteBridge), children);
}

export function createBrowserRouter(routes, opts = {}) {
  const router = Real.createMemoryRouter(routes, { ...opts, initialEntries: initialEntry(opts.basename) });
  router.subscribe((state) => report(state.location));
  window.__appblipsRouterNavigate = (to) => router.navigate(to);
  report(router.state.location);
  return router;
}
`;
}
