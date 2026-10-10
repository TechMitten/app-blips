// Import checks the preview bundler can't do. esbuild drops imports a
// TypeScript file never uses (they might be types), so an unused import of a
// missing file previews fine, yet the customer's `tsc -b` fails on it, and
// fails on any unused import under noUnusedLocals. This scans the import
// statements of the files an edit changed. Pattern-based: it reports only
// what it is sure of, and never runs the code.
import { isBareSpecifier, packageName, resolveImport, splitQuery } from './resolve.js';

const CODE_FILE_RE = /\.(tsx?|jsx?|mts|mjs)$/;
// import x from 'y' | import { a, b as c } from 'y' | import * as ns from 'y' |
// import 'y' | export { a } from 'y' | export * from 'y'
const IMPORT_RE = /^[ \t]*(import|export)\s+(type\s+)?([\w$*{}\s,]*?)\s*(?:from\s*)?(['"])([^'"\n]+)\4/gm;
const IGNORED_SPECIFIERS = /^(node:|virtual:|\/@|https?:|data:)/;

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (code.charCodeAt(i) === 10) line++;
  return line;
}

// Local names an import clause binds: default, named (with `as`), namespace.
function boundNames(clause) {
  const names = [];
  const trimmed = clause.trim();
  if (!trimmed) return names;
  const braces = trimmed.match(/\{([^}]*)\}/);
  const outside = trimmed.replace(/\{[^}]*\}/, '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of outside) {
    const ns = part.match(/^\*\s+as\s+([\w$]+)$/);
    if (ns) names.push(ns[1]);
    else if (/^[\w$]+$/.test(part)) names.push(part);
  }
  if (braces) {
    for (const item of braces[1].split(',')) {
      const spec = item.trim().replace(/^type\s+/, '');
      if (!spec) continue;
      const alias = spec.match(/\bas\s+([\w$]+)$/);
      names.push(alias ? alias[1] : spec);
    }
  }
  return names.filter((n) => /^[\w$]+$/.test(n));
}

// opts: { paths (files to check), aliases, declared (package.json deps), noUnusedLocals }
export function checkImports(files, assets, { paths, aliases = [], declared = {}, noUnusedLocals = false }) {
  const errors = [];
  const ctx = { files, assets, aliases };
  for (const path of paths) {
    if (!CODE_FILE_RE.test(path) || typeof files[path] !== 'string') continue;
    const code = stripComments(files[path]);
    for (const match of code.matchAll(IMPORT_RE)) {
      const [, keyword, , clause, , rawSpec] = match;
      const spec = splitQuery(rawSpec).spec;
      const line = lineOf(code, match.index);
      const report = (text) => errors.push({ file: path, line, column: null, text, lineText: files[path].split('\n')[line - 1] || '', message: `${path}:${line}: ${text}` });
      if (IGNORED_SPECIFIERS.test(spec)) continue;
      if (isBareSpecifier(spec, aliases)) {
        const name = packageName(spec);
        if (!(name in declared) && !(`@types/${name.replace(/^@/, '').replace('/', '__')}` in declared)) {
          report(`"${name}" is imported but not listed in package.json.`);
        }
      } else if (!resolveImport(rawSpec, path, ctx)) {
        report(`Could not find "${rawSpec}".`);
        continue;
      }
      if (keyword !== 'import' || !noUnusedLocals) continue;
      // Every name the import binds must appear again somewhere in the file.
      const rest = code.slice(0, match.index) + code.slice(match.index + match[0].length);
      for (const name of boundNames(clause)) {
        const used = new RegExp(`(^|[^\\w$.])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(rest);
        if (!used) report(`"${name}" is imported but never used (the project's tsconfig has noUnusedLocals, so the build fails). Remove it.`);
      }
    }
  }
  return errors;
}
