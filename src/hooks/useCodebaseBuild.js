import { useEffect, useState } from 'react';
import { loadEsbuild } from '../lib/codebase/esbuildBrowser';
import { buildCodebasePreview, makeAssetUrl } from '../lib/codebase/preview';
import { blobBytes, ensureBlobs } from '../lib/blobStore';
import { isDesktop } from '../lib/desktop';

const IDLE = { html: '', building: false, preview: null, error: null };

// Rebuilds an imported codebase's preview document whenever its files change
// (debounced; a newer build always wins over one still running). Until the
// new build lands, the previous document stays up, so edits don't flash a
// blank preview. The route is read when a build starts: following links in
// the preview never triggers a rebuild, but the next rebuild opens where the
// user was.
export default function useCodebaseBuild({ enabled, files, assets, meta, projectId, routeRef, reloadKey }) {
  const [result, setResult] = useState(null);
  const active = Boolean(enabled && meta?.entry && files && Object.keys(files).length);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const done = (fields) => {
        if (!cancelled) setResult({ files, assets, meta, projectId, reloadKey, ...fields });
      };
      try {
        const esbuild = await loadEsbuild();
        // The browser dev build inlines assets, so their bytes must be loaded.
        if (!isDesktop && projectId) await ensureBlobs(projectId, Object.values(assets || {}));
        const assetUrl = makeAssetUrl({ projectId, isDesktop, bytesOf: blobBytes });
        const preview = await buildCodebasePreview(esbuild, {
          files, assets: assets || {}, meta, assetUrl, route: routeRef?.current || meta.route || '/',
        });
        done({ html: preview.html, preview, error: null });
      } catch (err) {
        console.error('[codebase] preview build failed:', err);
        done({ html: '', preview: null, error: String(err?.message || err) });
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, files, assets, meta, projectId, routeRef, reloadKey]);

  if (!active) return IDLE;
  const sameProject = result?.projectId === projectId;
  const fresh = sameProject && result.files === files && result.assets === assets && result.meta === meta && result.reloadKey === reloadKey;
  return {
    html: sameProject ? result.html : '',
    preview: sameProject ? result.preview : null,
    error: sameProject ? result.error : null,
    building: !fresh,
  };
}
