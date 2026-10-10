// The tools the model uses to edit an imported codebase, executed against the
// in-memory version (pure and synchronous, like pageTools.executeFilesTool).
// Every path is validated with the same rules main applies on disk;
// lockfiles and binary assets can't be edited as text.
import { applySurgicalEdits, viewCode } from '../edits.js';
import { checkCodebaseLimits, isLockfile, isProtectedPath, validateProjectPath } from './paths.js';

const MAX_LIST = 500;
const MAX_SEARCH_HITS = 50;

const fileParam = (description) => ({ type: 'string', description });

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
      description: 'Edit one existing text file with search/replace blocks. Each search must match the current file exactly once (copy it from read_file without the line numbers), unless occurrence or replace_all is set.',
      parameters: {
        type: 'object',
        properties: {
          file: fileParam('Repo-relative path of the file to edit.'),
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                search: { type: 'string', description: 'Exact existing text to replace.' },
                replace: { type: 'string', description: 'Replacement text.' },
                occurrence: { type: ['integer', 'null'], description: 'Which match to replace (1-based) when search appears several times. Null otherwise.' },
                replace_all: { type: ['boolean', 'null'], description: 'Replace every match. Null otherwise.' },
              },
              required: ['search', 'replace', 'occurrence', 'replace_all'],
              additionalProperties: false,
            },
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
    return { args: JSON.parse(toolCall.function?.arguments || '{}') };
  } catch (err) {
    return { error: `Arguments were not valid JSON: ${err.message}` };
  }
}

const fail = (state, error) => ({ state, applied: false, result: { success: false, error } });

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
    return { state, applied: false, result: { path, ...viewCode(files[path], { start_line: args.start_line, end_line: args.end_line }) } };
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

  if (name === 'apply_surgical_edits') {
    const problem = checkPath(args.file);
    if (problem) return fail(state, problem);
    const path = cleanPath(args.file);
    if (isProtectedPath(path)) return fail(state, `${path} is a lockfile and must not be edited; change package.json instead.`);
    if (typeof files[path] !== 'string') return fail(state, `No text file at ${path}.${assets[path] ? ' It is a binary file.' : ' Use create_file for new files.'}`);
    const result = applySurgicalEdits(files[path], args.edits);
    if (!result.success) return fail(state, result.error);
    const next = { ...files, [path]: result.code };
    const limit = checkCodebaseLimits(next, assets);
    if (limit) return fail(state, limit);
    return { state: { files: next, assets }, applied: true, result: { success: true, file: path } };
  }

  if (name === 'create_file') {
    const problem = checkPath(args.path);
    if (problem) return fail(state, problem);
    const path = cleanPath(args.path);
    if (isProtectedPath(path)) return fail(state, `${path} is a lockfile and must not be edited.`);
    if (assets[path]) return fail(state, `${path} is an existing binary file.`);
    if (typeof files[path] === 'string' && args.overwrite !== true) {
      return fail(state, `${path} already exists. Use apply_surgical_edits to change it, or set overwrite to true to replace it.`);
    }
    const lower = path.toLowerCase();
    const clash = Object.keys(files).concat(Object.keys(assets)).find((p) => p !== path && p.toLowerCase() === lower);
    if (clash) return fail(state, `${clash} already exists with different upper/lower case.`);
    if (typeof args.content !== 'string') return fail(state, 'content must be a string.');
    const next = { ...files, [path]: args.content };
    const limit = checkCodebaseLimits(next, assets);
    if (limit) return fail(state, limit);
    return { state: { files: next, assets }, applied: true, result: { success: true, file: path, created: !(path in files) } };
  }

  if (name === 'delete_file') {
    const problem = checkPath(args.path);
    if (problem) return fail(state, problem);
    const path = cleanPath(args.path);
    if (isProtectedPath(path) || ['package.json', 'index.html'].includes(path)) return fail(state, `${path} is required and can't be deleted.`);
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
  let args = {};
  try { args = JSON.parse(toolCall.function?.arguments || '{}'); } catch { /* defaults */ }
  if (name === 'list_files') return 'Looking through the project files…';
  if (name === 'read_file') return `Reading ${args.path || 'a file'}…`;
  if (name === 'search_files') return `Searching for "${String(args.query || '').slice(0, 40)}"…`;
  if (name === 'apply_surgical_edits') return `Editing ${args.file || 'a file'}…`;
  if (name === 'create_file') return `Creating ${args.path || 'a file'}…`;
  if (name === 'delete_file') return `Deleting ${args.path || 'a file'}…`;
  return `Calling ${name}…`;
}
