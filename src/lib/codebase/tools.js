// The tools the model uses to edit an imported codebase, executed against the
// in-memory version (pure and synchronous, like pageTools.executeFilesTool).
// Every path is validated with the same rules main applies on disk;
// lockfiles and binary assets can't be edited as text.
import { applySurgicalEdits, viewCode, invalidArgumentsError } from '../edits.js';
import { checkCodebaseLimits, isLockfile, validateProjectPath } from './paths.js';

const MAX_LIST = 500;
const MAX_SEARCH_HITS = 50;
const MAX_BATCH_CHANGES = 50;

const fileParam = (description) => ({ type: 'string', description });

const editItems = {
  type: 'object',
  properties: {
    search: { type: 'string', description: 'Exact current source copied without line numbers. Include enough context to be unique.' },
    replace: { type: 'string', description: 'Literal replacement text. Empty string deletes the matched text.' },
    occurrence: { type: ['integer', 'null'], description: '1-based match to replace. Null for a unique search.' },
    replace_all: { type: ['boolean', 'null'], description: 'True to replace every match. Null otherwise; do not combine with occurrence.' },
  },
  required: ['search', 'replace', 'occurrence', 'replace_all'],
  additionalProperties: false,
};

export const CODEBASE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List the project\'s files (repo-relative paths with sizes). Use a prefix such as "src/components/" to narrow it down.',
      parameters: {
        type: 'object',
        properties: { prefix: { type: ['string', 'null'], description: 'Only list paths starting with this. Null for all files.' } },
        required: ['prefix'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file, with line numbers. Long files return 200 lines at a time; pass start_line/end_line for other parts (at most 400 lines per call).',
      parameters: {
        type: 'object',
        properties: {
          path: fileParam('Repo-relative path, e.g. "src/App.tsx".'),
          start_line: { type: ['integer', 'null'], description: 'First line to show (1-based). Null to start at the top.' },
          end_line: { type: ['integer', 'null'], description: 'Last line to show. Null for 200 lines from start_line.' },
        },
        required: ['path', 'start_line', 'end_line'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search all text files for a string (case-insensitive) and return matching lines as path:line: text. Use it to find where a component, class name or piece of copy lives.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to find.' },
          prefix: { type: ['string', 'null'], description: 'Only search paths starting with this. Null for all files.' },
        },
        required: ['query', 'prefix'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_surgical_edits',
      description: 'Edit one existing text file with ordered search/replace blocks copied from current source without line numbers. Only line-ending and indentation differences are tolerated. All blocks must succeed or the file stays unchanged. Use apply_file_changes for related changes across files.',
      parameters: {
        type: 'object',
        properties: {
          file: fileParam('Repo-relative path of the file to edit.'),
          edits: {
            type: 'array',
            items: editItems,
          },
        },
        required: ['file', 'edits'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_file_changes',
      description: 'Apply related edits, new files and deletions across the project atomically, in order. Useful for components plus imports, routes plus navigation, or shared styles. If any change fails, NONE are applied. Read current files first. The build is checked after the entire batch.',
      parameters: {
        type: 'object',
        properties: {
          changes: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_BATCH_CHANGES,
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['edit', 'create', 'delete'] },
                path: fileParam('Repo-relative file path.'),
                edits: { type: ['array', 'null'], items: editItems, description: 'For edit: non-empty search/replace blocks, applied in order. Null otherwise.' },
                content: { type: ['string', 'null'], description: 'For create: complete contents of the new file. Null otherwise. Existing files cannot be overwritten.' },
              },
              required: ['action', 'path', 'edits', 'content'],
              additionalProperties: false,
            },
          },
        },
        required: ['changes'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a new text file (e.g. a new page component). Set overwrite to true only to replace a whole existing file; prefer apply_surgical_edits for changes.',
      parameters: {
        type: 'object',
        properties: {
          path: fileParam('Repo-relative path, e.g. "src/pages/Pricing.tsx".'),
          content: { type: 'string', description: 'The complete file contents.' },
          overwrite: { type: ['boolean', 'null'], description: 'True to replace an existing file. Null otherwise.' },
        },
        required: ['path', 'content', 'overwrite'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file (code or an image/asset) that is no longer used. Remove its imports first.',
      parameters: {
        type: 'object',
        properties: { path: fileParam('Repo-relative path of the file to delete.') },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
];

// Tools that only read; ask mode gets these and nothing else.
export const READ_ONLY_TOOL_NAMES = new Set(['list_files', 'read_file', 'search_files']);
export const CODEBASE_READ_TOOLS = CODEBASE_TOOLS.filter((t) => READ_ONLY_TOOL_NAMES.has(t.function.name));

function parseArgs(toolCall) {
  try {
    const args = JSON.parse(toolCall.function?.arguments || '{}');
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: 'Arguments must be a JSON object.' };
    return { args };
  } catch (err) {
    return { error: invalidArgumentsError(err) };
  }
}

const fail = (state, error, details = {}) => ({ state, applied: false, result: { success: false, error, ...details } });

function checkPath(path) {
  if (typeof path !== 'string' || !path.trim()) return 'A path is required.';
  return validateProjectPath(path.trim().replace(/^\.\//, ''));
}

function without(map, key) {
  const copy = { ...map };
  delete copy[key];
  return copy;
}

function cleanPath(path) {
  return path.trim().replace(/^\.\//, '');
}

// state: { files: {path: text}, assets: {path: hash} }. Returns
// { state, applied, result } where result is reported back to the model.
export function executeCodebaseTool(state, toolCall) {
  return executeTool(state, toolCall);
}

// Batches stage changes privately and validate size limits on the final tree.
// This also allows replacing a file at the project's file-count limit.
function executeTool(state, toolCall, checkLimits = true) {
  const name = toolCall.function?.name;
  const { args, error } = parseArgs(toolCall);
  if (error) return fail(state, error);
  const { files, assets } = state;

  if (name === 'list_files') {
    const prefix = typeof args.prefix === 'string' ? cleanPath(args.prefix) : '';
    const entries = [
      ...Object.entries(files).map(([path, text]) => `${path} (${text.length} chars)`),
      ...Object.keys(assets).map((path) => `${path} (binary)`),
    ].filter((line) => line.startsWith(prefix)).sort();
    return {
      state,
      applied: false,
      result: { success: true, count: entries.length, files: entries.slice(0, MAX_LIST), truncated: entries.length > MAX_LIST || undefined },
    };
  }

  if (name === 'read_file') {
    const problem = checkPath(args.path);
    if (problem) return fail(state, problem);
    const path = cleanPath(args.path);
    if (assets[path]) return fail(state, `${path} is a binary file (image/font) and can't be read as text.`);
    if (typeof files[path] !== 'string') return fail(state, `No file at ${path}. Use list_files or search_files to find the right path.`);
    if (files[path] === '') return { state, applied: false, result: { success: true, path, totalLines: 0, code: '' } };
    const totalLines = files[path].split(/\r?\n/).length;
    for (const field of ['start_line', 'end_line']) {
      if (args[field] != null && (!Number.isInteger(args[field]) || args[field] < 1)) return fail(state, `${field} must be a positive line number or null.`);
    }
    const start = args.start_line || 1;
    if (start > totalLines) return fail(state, `${path} has ${totalLines} lines; start_line is beyond the end of the file.`);
    if (args.end_line != null && args.end_line < start) return fail(state, 'end_line must be at least start_line.');
    const read = viewCode(files[path], { start_line: start, end_line: Math.min(args.end_line || start + 199, start + 399) });
    return { state, applied: false, result: { path, ...read, totalLines, truncated: read.endLine < totalLines || undefined } };
  }

  if (name === 'search_files') {
    const query = String(args.query || '').toLowerCase();
    if (!query) return fail(state, 'query is required.');
    const prefix = typeof args.prefix === 'string' ? cleanPath(args.prefix) : '';
    const hits = [];
    for (const path of Object.keys(files).sort()) {
      if (!path.startsWith(prefix) || isLockfile(path)) continue;
      const lines = files[path].split('\n');
      for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS; i++) {
        if (lines[i].toLowerCase().includes(query)) hits.push(`${path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
      if (hits.length >= MAX_SEARCH_HITS) break;
    }
    return { state, applied: false, result: { success: true, matches: hits, truncated: hits.length >= MAX_SEARCH_HITS || undefined } };
  }

  if (name === 'apply_file_changes') {
    if (!Array.isArray(args.changes) || !args.changes.length || args.changes.length > MAX_BATCH_CHANGES) {
      return fail(state, `Provide 1-${MAX_BATCH_CHANGES} file changes.`);
    }
    let staged = state;
    for (const [index, change] of args.changes.entries()) {
      const reject = (error, details = {}) => fail(state, error, {
        ...details, failedChange: index + 1, file: change?.path,
        rolledBack: true, instruction: 'No changes in this batch were applied. Read the current source and retry the complete batch with corrected changes.',
      });
      if (!change || !['edit', 'create', 'delete'].includes(change.action)) return reject('Each change needs an edit, create or delete action.');
      if (change.action !== 'edit' && change.edits != null) return reject('edits must be null for create/delete.');
      if (change.action !== 'create' && change.content != null) return reject('content must be null for edit/delete.');
      const names = { edit: 'apply_surgical_edits', create: 'create_file', delete: 'delete_file' };
      const params = change.action === 'edit'
        ? { file: change.path, edits: change.edits }
        : { path: change.path, content: change.content, overwrite: false };
      const outcome = executeTool(staged, { function: { name: names[change.action], arguments: JSON.stringify(params) } }, false);
      if (!outcome.result.success) return reject(outcome.result.error, outcome.result);
      staged = outcome.state;
    }
    const limit = checkCodebaseLimits(staged.files, staged.assets);
    if (limit) return fail(state, limit, { rolledBack: true });
    const changedFiles = [...new Set([...Object.keys(state.files), ...Object.keys(staged.files), ...Object.keys(state.assets), ...Object.keys(staged.assets)])]
      .filter((path) => state.files[path] !== staged.files[path] || state.assets[path] !== staged.assets[path]);
    return { state: changedFiles.length ? staged : state, applied: changedFiles.length > 0, result: { success: true, changed: changedFiles.length > 0, files: changedFiles } };
  }

  if (name === 'apply_surgical_edits') {
    const problem = checkPath(args.file);
    if (problem) return fail(state, problem);
    const path = cleanPath(args.file);
    if (isLockfile(path)) return fail(state, `${path} is a lockfile and must not be edited; change package.json instead.`);
    if (typeof files[path] !== 'string') return fail(state, `No text file at ${path}.${assets[path] ? ' It is a binary file.' : ' Use create_file for new files.'}`);
    const result = applySurgicalEdits(files[path], args.edits, { conservative: true });
    if (!result.success) {
      // The model needs the failure's position and real source, rather than a
      // generic 'not found'. Never apply a best guess from this diagnostic.
      const searchLine = result.failedBlock?.split(/\r?\n/).find((line) => line.trim().length > 3)?.trim();
      const near = result.matchLines?.[0] || (searchLine ? files[path].split(/\r?\n/).findIndex((line) => line.includes(searchLine)) + 1 : 0);
      return fail(state, result.error, {
        ...result, file: path, rolledBack: true,
        ...(near ? { context: viewCode(files[path], { start_line: Math.max(1, near - 3), end_line: near + 6 }).code } : {}),
        instruction: `None of this file's edits were applied. Read ${path} for current source, remove line numbers, use a unique search block, and retry all edits. Blocks run in order against the result of earlier blocks.`,
      });
    }
    if (result.code === files[path]) return { state, applied: false, result: { success: true, file: path, changed: false } };
    const next = { ...files, [path]: result.code };
    const limit = checkLimits ? checkCodebaseLimits(next, assets) : null;
    if (limit) return fail(state, limit);
    return { state: { files: next, assets }, applied: true, result: { success: true, file: path, changed: true } };
  }

  if (name === 'create_file') {
    const problem = checkPath(args.path);
    if (problem) return fail(state, problem);
    const path = cleanPath(args.path);
    if (isLockfile(path)) return fail(state, `${path} is a lockfile and must not be edited.`);
    if (assets[path]) return fail(state, `${path} is an existing binary file.`);
    if (typeof files[path] === 'string' && args.overwrite !== true) {
      return fail(state, `${path} already exists. Use apply_surgical_edits to change it, or set overwrite to true to replace it.`);
    }
    const lower = path.toLowerCase();
    const clash = Object.keys(files).concat(Object.keys(assets)).find((p) => p !== path && p.toLowerCase() === lower);
    if (clash) return fail(state, `${clash} already exists with different upper/lower case.`);
    if (typeof args.content !== 'string') return fail(state, 'content must be a string.');
    if (files[path] === args.content) return { state, applied: false, result: { success: true, file: path, changed: false } };
    const next = { ...files, [path]: args.content };
    const limit = checkLimits ? checkCodebaseLimits(next, assets) : null;
    if (limit) return fail(state, limit);
    return { state: { files: next, assets }, applied: true, result: { success: true, file: path, created: !(path in files) } };
  }

  if (name === 'delete_file') {
    const problem = checkPath(args.path);
    if (problem) return fail(state, problem);
    const path = cleanPath(args.path);
    if (isLockfile(path) || ['package.json', 'index.html'].includes(path)) return fail(state, `${path} is required and can't be deleted.`);
    if (typeof files[path] === 'string') {
      return { state: { files: without(files, path), assets }, applied: true, result: { success: true, deleted: path } };
    }
    if (assets[path]) {
      return { state: { files, assets: without(assets, path) }, applied: true, result: { success: true, deleted: path } };
    }
    return fail(state, `No file at ${path}.`);
  }

  return fail(state, `Unknown tool: ${name}`);
}

export function describeCodebaseToolCall(toolCall) {
  const name = toolCall.function?.name;
  if (name === 'list_files' || name === 'read_file') return 'Reviewing your site…';
  if (name === 'search_files') return 'Finding where to make the change…';
  if (name === 'apply_surgical_edits' || name === 'apply_file_changes') return 'Updating your site…';
  if (name === 'create_file') return 'Adding new content…';
  if (name === 'delete_file') return 'Removing content…';
  return 'Working on your changes…';
}
