// Run the workspace's sandboxed preview before accepting an import. Test
// storage is disposable and its messages never enter the workspace hooks.
import { BRIDGE_CHANNEL, BRIDGE_PROTOCOL_VERSION, injectPreviewBridge } from '../../previewBridge.js';
import { loadEsbuild } from './esbuildBrowser.js';
import { buildCodebasePreview, makeAssetUrl, mapPreviewLine } from './preview.js';
import { jsonForScript } from './previewHtml.js';

const abortError = () => new DOMException('Aborted', 'AbortError');

export async function checkCodebaseRuntime({ files, assets, meta, blobs, assetUrl, signal, diagnostics, timeoutMs = 20000, settleMs = 2000 }) {
  if (signal?.aborted) throw abortError();
  const runtimeCheckToken = crypto.randomUUID();
  const preview = await buildCodebasePreview(await loadEsbuild(), {
    files, assets, meta, diagnostics, runtimeCheckToken,
    assetUrl: assetUrl || makeAssetUrl({ bytesOf: (hash) => blobs?.get(hash) }),
  });
  if (!preview.ok) return { errors: preview.errors };
  if (signal?.aborted) throw abortError();
  const { srcDoc, token } = injectPreviewBridge(preview.html, { projectMode: true, initialStorage: {} });
  const lineOffset = srcDoc.split('\n').length - preview.html.split('\n').length;
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:1280px;height:800px;border:0;pointer-events:none;';
    let settled = false;
    let moduleReady = false;
    let pageLoaded = false;
    let fetches = 0;
    let settleTimer;
    let deadline;
    const cleanUp = () => {
      clearTimeout(settleTimer);
      clearTimeout(deadline);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      frame.remove();
    };
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      cleanUp();
      if (error) reject(error); else resolve(result);
    };
    const onAbort = () => finish(null, abortError());
    const scheduleSuccess = () => {
      if (settled) return;
      clearTimeout(settleTimer);
      if (moduleReady && pageLoaded && fetches === 0) settleTimer = setTimeout(() => finish({ errors: [] }), settleMs);
    };
    const onMessage = (event) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (data?.__appblipsRuntime === runtimeCheckToken) {
        if (data.type === 'module-ready') moduleReady = true;
        if (data.type === 'fetch-pending') fetches = data.count;
        scheduleSuccess();
      }
      if (data?.__orion !== BRIDGE_CHANNEL || data.v !== BRIDGE_PROTOCOL_VERSION || data.token !== token || data.type !== 'runtime_error') return;
      const payload = data.payload || {};
      const where = mapPreviewLine(preview, payload.line ? payload.line - lineOffset : 0, payload.col);
      const detail = String(payload.message || 'The site failed while opening.').slice(0, 1000);
      finish({ errors: [{
        file: where?.file, line: where?.line,
        message: `Preview startup error${where ? ` in ${where.file}:${where.line}` : ''}: ${detail}. The standalone preview cannot run Node build scripts to generate missing content. Provide required data directly in the project and keep existing consumers working.`,
      }] });
    };
    // Track startup fetches as well as synchronous module execution. The
    // wrapper lives only in this frame, never in exports or saved files.
    const fetchTracker = `<script>(function(){var pending=0;var original=window.fetch;function post(){parent.postMessage({__appblipsRuntime:${jsonForScript(runtimeCheckToken)},type:'fetch-pending',count:pending},'*');}window.fetch=function(){pending++;post();return Promise.resolve().then(function(args){return original.apply(window,args);}.bind(null,arguments)).then(function(value){pending--;post();return value;},function(error){pending--;post();throw error;});};})();</script>`;
    const head = /<head\b[^>]*>/i.exec(srcDoc);
    const at = head ? head.index + head[0].length : 0;
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => { pageLoaded = true; scheduleSuccess(); });
    signal?.addEventListener('abort', onAbort, { once: true });
    deadline = setTimeout(() => finish({ errors: [{
      code: 'preview-unavailable', message: 'The preview could not finish loading to verify this site. Check your connection and try again. Your original files are unchanged.',
    }] }), timeoutMs);
    frame.srcdoc = srcDoc.slice(0, at) + fetchTracker + srcDoc.slice(at);
    document.body.appendChild(frame);
    if (signal?.aborted) onAbort();
  });
}
