// Builds the preview document for an imported codebase and runs the build
// check the AI edit loop uses. Both take an esbuild instance (see
// esbuildBrowser.js) so tests can run them in Node.
import { bundleCodebase } from './bundler.js';
import { buildPreviewHtml } from './previewHtml.js';
import { packageVersions, readAliases, strictnessFlags } from './config.js';
import { checkImports } from './importCheck.js';
import { mimeTypeFor } from './paths.js';
import { originalPosition } from '../sourceMap.js';

// Desktop serves imported images/fonts from the project's blobs folder
// (electron/main.js serveAsset); elsewhere they are inlined from the cache.
export function makeAssetUrl({ projectId, isDesktop, bytesOf }) {
  return (path, hash) => {
    const ext = (path.match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin').toLowerCase();
    if (isDesktop && projectId) return `appblips://assets/${projectId}/${hash}.${ext}`;
    const bytes = bytesOf?.(hash);
    if (!bytes) return '';
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `data:${mimeTypeFor(path)};base64,${btoa(binary)}`;
  };
}

function undeclaredErrors(undeclared) {
  return undeclared.map((name) => ({
    file: 'package.json',
    line: null,
    column: null,
    text: `The code imports "${name}", which is not listed in package.json. Add it to "dependencies" (or stop importing it); the real build can't install it otherwise.`,
    lineText: '',
    message: `package.json: "${name}" is imported but not listed in dependencies.`,
  }));
}

// Errors the AI must fix before a change counts as done: the bundle must
// build, every package must be in package.json, and the files this edit
// changed (compared with `baseline`, the files before it) must have no
// imports `tsc -b` would reject.
export async function checkCodebaseBuild(esbuild, { files, assets, meta, baseline = null }) {
  const result = await bundleCodebase(esbuild, { files, assets, meta, assetUrl: () => 'data:,' });
  if (!result.ok) return { errors: result.errors };
  const errors = undeclaredErrors(result.undeclared);
  if (baseline) {
    const changed = Object.keys(files).filter((p) => files[p] !== baseline[p]);
    const importErrors = checkImports(files, assets, {
      paths: changed,
      aliases: readAliases(files),
      declared: packageVersions(files).declared,
      noUnusedLocals: Boolean(strictnessFlags(files).noUnusedLocals),
    });
    for (const e of importErrors) if (!errors.some((x) => x.message === e.message)) errors.push(e);
  }
  return { errors };
}

export async function buildCodebasePreview(esbuild, { files, assets, meta, assetUrl, route = '/' }) {
  const bundle = await bundleCodebase(esbuild, { files, assets, meta, assetUrl });
  if (!bundle.ok) return { ok: false, errors: bundle.errors, html: buildErrorPage(bundle.errors) };
  const tailwindVersion = packageVersions(files).versions.tailwindcss || '';
  const { html, bundleLine, notices } = buildPreviewHtml({
    files, meta, bundle, env: bundle.env, publicMap: bundle.publicMap, route, tailwindVersion,
  });
  const warnings = [...bundle.warnings];
  return {
    ok: true,
    html,
    bundleLine,
    map: bundle.map,
    errors: [],
    undeclared: bundle.undeclared,
    warnings,
    notices,
  };
}

// Line in the preview document -> project file and line, through the bundle's
// source map. null when the line isn't inside the bundle.
export function mapPreviewLine(preview, line, column) {
  if (!preview?.map || !preview.bundleLine || !line) return null;
  const bundleLine = line - preview.bundleLine + 1;
  if (bundleLine < 1) return null;
  const pos = originalPosition(preview.map, bundleLine, column);
  if (!pos) return null;
  const source = pos.source.replace(/^(vfs|router-shim):/, '');
  if (source.startsWith('<')) return null;
  return { file: source, line: pos.line, column: pos.column };
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// What the preview shows when the project doesn't build: the errors, in a
// plain page (the AI gets the same list).
export function buildErrorPage(errors) {
  const items = errors.slice(0, 20).map((e) => `<li><code>${escapeHtml(e.file ? `${e.file}${e.line ? `:${e.line}` : ''}` : 'build')}</code><p>${escapeHtml(e.text)}</p>${e.lineText ? `<pre>${escapeHtml(e.lineText)}</pre>` : ''}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Build error</title><style>
body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:32px;background:#fff7ed;color:#431407}
h1{font-size:18px;margin:0 0 4px}p.lead{margin:0 0 20px;color:#9a3412}ul{list-style:none;padding:0;margin:0}
li{background:#fff;border:1px solid #fed7aa;border-radius:10px;padding:12px 14px;margin-bottom:10px}
code{font:12px ui-monospace,monospace;color:#c2410c}li p{margin:4px 0 0}pre{margin:8px 0 0;padding:8px;background:#fff7ed;border-radius:6px;overflow:auto;font-size:12px}
</style></head><body><h1>This site doesn't build right now</h1><p class="lead">Ask the AI to fix it, or undo the last change.</p><ul>${items}</ul></body></html>`;
}
