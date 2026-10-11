import { generateCodebaseEdit } from './llm.js';
import { loadEsbuild } from './esbuildBrowser.js';
import { checkCodebaseBuild } from './preview.js';
import { environmentRemovalPrompt, inspectEnvironment } from './environment.js';
import { checkCodebaseRuntime } from './runtimeCheck.js';

// Work on a copy; failures/cancellation leave the upload available to retry.
export async function prepareEnvironmentFreeSite(imported, {
  signal, onChunk, reasoningEffort = 'none', generateEdit = generateCodebaseEdit,
  runtimeCheck = checkCodebaseRuntime,
  buildCheck = async (files, assets, { diagnostics } = {}) => checkCodebaseBuild(await loadEsbuild(), {
    files, assets, meta: imported.meta, baseline: imported.files, diagnostics,
  }),
} = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let runtimeCache;
  let initialRuntimeErrors = [];
  const checkRuntime = async (files, assets, diagnostics) => {
    if (runtimeCache?.files === files && runtimeCache.assets === assets) return runtimeCache.result;
    onChunk?.('Opening the site to check that it runs…', 'status');
    const result = await runtimeCheck({ files, assets, meta: imported.meta, blobs: imported.blobs, signal, diagnostics });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const unavailable = result.errors?.find((error) => error.code === 'preview-unavailable');
    if (unavailable) {
      const error = new Error(unavailable.message);
      error.isNonRepairable = true;
      throw error;
    }
    runtimeCache = { files, assets, result };
    return result;
  };
  // A ZIP can contain unused templates or an unused private .env. There is
  // nothing to rewrite when no executable code/scripts need those settings.
  if (!inspectEnvironment(imported.files, [], { includeTemplates: false }).detected) {
    onChunk?.('Checking whether your site already works without these settings…', 'status');
    const verified = await buildCheck(imported.files, imported.assets);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!verified?.errors?.length) {
      const runtime = await checkRuntime(imported.files, imported.assets);
      if (!runtime.errors?.length) return { ...imported, meta: { ...imported.meta, environmentResolution: 'verified' } };
      initialRuntimeErrors = runtime.errors;
    }
  }
  const check = async (files, assets, options) => {
    const result = await buildCheck(files, assets, options);
    const remaining = inspectEnvironment(files, [], { includeTemplates: false });
    const errors = [...(result?.errors || [])];
    if (remaining.detected) errors.push({ message: `The site still requires custom environment settings. Remove these references: ${remaining.variables.map((v) => v.name).join(', ')}${remaining.dynamicFiles.length ? `; inspect ${remaining.dynamicFiles.join(', ')}` : ''}.` });
    if (!errors.length) errors.push(...((await checkRuntime(files, assets, options?.diagnostics)).errors || []));
    return { errors };
  };
  const edited = await generateEdit({
    prompt: environmentRemovalPrompt(imported.environment, imported.files) + (initialRuntimeErrors.length ? `\n\nFix these preview startup errors too:\n${initialRuntimeErrors.map((error) => error.message).join('\n')}` : ''),
    files: imported.files, assets: imported.assets, meta: imported.meta,
    signal, onChunk, reasoningEffort, buildCheck: check, maxReadOnlyTurns: 3,
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const verified = await check(edited.files, edited.assets || imported.assets);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (verified.errors.length) throw new Error('AI could not make the site run without environment settings yet. Your original files are still available. Try again or fill in the settings yourself.');
  return {
    ...imported, files: edited.files, assets: edited.assets || imported.assets,
    originalFiles: imported.files, originalAssets: imported.assets,
    meta: { ...imported.meta, environmentResolution: 'ai' },
  };
}
