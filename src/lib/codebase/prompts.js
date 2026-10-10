// System prompt and starting context for editing an imported React + Vite +
// TypeScript codebase. The model sees the file tree, package.json, the
// TypeScript strictness flags and the few files that shape the app, and reads
// the rest on demand with the tools.
import { readPackageJson, strictnessFlags } from './config.js';
import { isLockfile } from './paths.js';

const CONTEXT_BUDGET = 40000;
const MAX_TREE_LINES = 400;

export const CODEBASE_SYSTEM_PROMPT = `You are editing a real React + Vite + TypeScript website project that a web designer built for their customer. The customer describes changes in plain English; you make them by editing the project's files with the tools provided. The project must keep building with its own toolchain (\`npm install && npm run build\`, which runs \`tsc -b\` then \`vite build\`), so treat it like a professional codebase, not a prototype.

How to work:
- Find the right place before editing: use search_files for copy, class names or component names, and read_file to see the exact current text. Never guess file contents.
- Make focused changes with apply_surgical_edits for one file. For changes that belong together across files (components and imports, routes and navigation, shared styles), use apply_file_changes to edit/create/delete them in one atomic batch. The batch either succeeds completely or changes nothing; the build is checked after the entire batch.
- Copy search text from current source without line numbers. Include enough surrounding code to identify one location. Only indentation and line-ending differences are tolerated; whitespace within strings and JSX text must match. Set occurrence (1-based) or replace_all explicitly for repeated matches. Blocks run in order, so later searches must match the result of earlier edits.
- When an edit fails, no blocks from that file or batch were applied. Use failedEdit/failedChange, matchLines and context to understand why; read the current file and retry the entire failed operation with corrected anchors. Never finish while a requested edit remains failed. Use create_file only for new files, e.g. a new page component.
- Keep the project's existing structure, naming, components and styling approach. Reuse existing components (for example src/components/ui/*) and the Tailwind theme tokens (bg-primary, text-muted-foreground, ...) instead of inventing new styles.
- TypeScript must stay clean under the project's tsconfig: every import used, no unused variables or parameters, correct types, no \`any\` unless the file already uses it. The real build fails on any type error even when the preview works.
- Only import packages that are listed in package.json. To use a new npm package, add it to package.json "dependencies" (with a version range) in the same change. Never edit package-lock.json or other lockfiles.
- New routes: add the page component and register it wherever the project defines its routes (the router setup in main.tsx/App.tsx), and add navigation links the same way existing ones are written.
- Images and fonts live in src/assets or public/. Files in public/ are referenced by absolute path ("/logo.svg"); files in src/assets are imported.
- Don't change build or tooling config (vite.config, tsconfig, eslint, postcss, tailwind config) unless the request needs it.
- When you are done, stop calling tools and reply with one short sentence (20 words or fewer), in plain language for a non-technical customer, saying generally what changed. Do not include file paths, line numbers, error messages, code, or implementation details.`;

export const CODEBASE_ASK_PROMPT = `You are a helpful assistant for a customer who owns a React + Vite + TypeScript website project (built by their web designer) and edits it in AppBlips. Answer their question about the site directly and in plain, friendly language; they are not a developer. You can look at the project with list_files, read_file and search_files, but you cannot change anything in this mode: if they want a change, tell them to switch to Build mode and describe it.`;

function fence(path, text) {
  const ext = path.split('.').pop();
  return `### ${path}\n\`\`\`${ext}\n${text}\n\`\`\``;
}

// The file that defines the routes: wherever createBrowserRouter or <Routes> appears.
export function findRoutesFile(files, entry) {
  const candidates = Object.keys(files).filter((p) => /^src\/.*\.(t|j)sx?$/.test(p));
  return candidates.find((p) => p !== entry && /createBrowserRouter|createHashRouter|<Routes\b/.test(files[p])) || null;
}

function mainCss(files, entry) {
  const entryText = files[entry] || '';
  const imported = [...entryText.matchAll(/import\s+["']\.\/([^"']+\.css)["']/g)].map((m) => `src/${m[1]}`);
  return imported.find((p) => typeof files[p] === 'string') || ['src/index.css', 'src/App.css', 'src/styles/globals.css'].find((p) => typeof files[p] === 'string') || null;
}

export function formatCodebaseContext(files, assets, meta) {
  const tree = [...Object.keys(files), ...Object.keys(assets).map((p) => `${p} (binary)`)].sort();
  const parts = [];
  parts.push(`## Project files (${tree.length})\n${tree.slice(0, MAX_TREE_LINES).join('\n')}${tree.length > MAX_TREE_LINES ? `\n… ${tree.length - MAX_TREE_LINES} more (use list_files)` : ''}`);
  const flags = Object.keys(strictnessFlags(files));
  if (flags.length) parts.push(`## TypeScript checks the build enforces\n${flags.join(', ')}`);
  const pkg = readPackageJson(files);
  const deps = { dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} };
  parts.push(`## package.json dependencies\n\`\`\`json\n${JSON.stringify(deps, null, 2)}\n\`\`\``);

  let budget = CONTEXT_BUDGET - parts.join('\n\n').length;
  const entry = meta?.entry || 'src/main.tsx';
  const appFile = ['src/App.tsx', 'src/App.jsx', 'src/app.tsx'].find((p) => typeof files[p] === 'string');
  const keyFiles = [entry, appFile, findRoutesFile(files, entry), mainCss(files, entry)]
    .filter((p, i, all) => p && all.indexOf(p) === i && typeof files[p] === 'string' && !isLockfile(p));
  for (const path of keyFiles) {
    const block = fence(path, files[path]);
    if (block.length > budget) {
      parts.push(`### ${path}\n(${files[path].length} chars — read it with read_file)`);
      continue;
    }
    parts.push(block);
    budget -= block.length;
  }
  return parts.join('\n\n');
}

export function buildRepairInstruction(errors) {
  const list = errors.slice(0, 12).map((e) => `- ${e.message || e.text || 'Unknown build error'}${e.lineText ? `\n    ${e.lineText.trim()}` : ''}`).join('\n');
  return `The project no longer builds. Fix these errors with the tools, then reply when it builds again:\n${list}`;
}
