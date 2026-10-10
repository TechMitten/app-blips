// Renderer-console diagnostics for imported sites, including production
// desktop builds. Log metadata and failures, never model messages or source maps.
let nextRun = 0;

export function createCodebaseDiagnostics(scope, context = {}) {
  const runId = `${scope}-${++nextRun}`;
  const started = performance.now();
  const write = (level, event, details = {}) => {
    const fields = {
      ...context, ...details, elapsedMs: Math.round(performance.now() - started),
    };
    console[level](`[AppBlips codebase][${runId}] ${event}`, Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ));
  };
  return {
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
  };
}

export function changedProjectPaths(files, assets, previousFiles, previousAssets) {
  return [...new Set([
    ...Object.keys(files), ...Object.keys(assets),
    ...Object.keys(previousFiles), ...Object.keys(previousAssets),
  ])].filter((path) => files[path] !== previousFiles[path] || assets[path] !== previousAssets[path]).sort();
}

// Tool results can contain whole files and replacement blocks. Keep the
// diagnostic useful without dumping the project's contents into the console.
export function toolDiagnostic(toolCall, outcome) {
  let args = {};
  try { args = JSON.parse(toolCall.function?.arguments || '{}'); } catch { /* reported by the tool */ }
  const result = outcome.result;
  return {
    tool: toolCall.function?.name,
    callId: toolCall.id,
    path: args?.file || args?.path,
    prefix: args?.prefix,
    paths: Array.isArray(args?.changes) ? args.changes.map((change) => change?.path) : undefined,
    applied: outcome.applied,
    success: result.success,
    error: result.error,
    failedEdit: result.failedEdit,
    failedChange: result.failedChange,
    matchLines: result.matchLines,
    rolledBack: result.rolledBack,
    instruction: result.instruction,
    changedFiles: outcome.applied ? result.files : undefined,
    fileCount: result.count,
    matchCount: result.matches?.length,
    totalLines: result.totalLines,
    truncated: result.truncated,
  };
}
