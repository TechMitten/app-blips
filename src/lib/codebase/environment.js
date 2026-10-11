// Inspect settings without executing imported code or opening private .env files.
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { transform } from 'sucrase';
import { checkCodebaseLimits } from './paths.js';

const parser = Parser.extend(jsx());
const BUILT_INS = new Set(['BASE_URL', 'MODE', 'DEV', 'PROD', 'SSR']);
export const ENV_TEMPLATES = ['.env.example', '.env.sample', '.env.template', '.env.local.example'];
export const isPrivateEnvPath = (path) => /^\.env(?:\..+)?$/.test(path.split('/').pop()) && !/\.(example|sample|template)$/.test(path);

export function parseEnv(text = '') {
  const values = {};
  const invalidLines = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) { invalidLines.push(index + 1); continue; }
    const [, key, raw] = match;
    let value;
    if (/^["']/.test(raw)) {
      const quoted = raw.match(/^(["'])(.*?)\1\s*(?:#.*)?$/);
      if (!quoted) { invalidLines.push(index + 1); continue; }
      value = quoted[2];
    } else value = raw.replace(/\s*#.*$/, '').trim();
    Object.defineProperty(values, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return { values, invalidLines };
}

function property(node) {
  return node?.computed ? (typeof node.property?.value === 'string' ? node.property.value : null) : node?.property?.name;
}

function envObject(node) {
  if (node?.type !== 'MemberExpression' || property(node) !== 'env') return null;
  if (node.object?.type === 'MetaProperty' && node.object.meta.name === 'import' && node.object.property.name === 'meta') return 'vite';
  if (node.object?.type === 'Identifier' && node.object.name === 'process') return 'process';
  return null;
}

export function inspectEnvironment(files, skipped = [], { includeTemplates = true } = {}) {
  const variables = new Map();
  const dynamicFiles = new Set();
  const envFiles = skipped.map((item) => item.path).filter(isPrivateEnvPath);
  const add = (name, path, source) => {
    if ((source === 'vite' && BUILT_INS.has(name)) || (source === 'process' && name === 'NODE_ENV')) return;
    const previous = variables.get(name);
    variables.set(name, { name, public: name.startsWith('VITE_') && source !== 'process', files: [...new Set([...(previous?.files || []), path])], ...((previous?.public === false) ? { public: false } : {}) });
  };

  for (const [path, text] of Object.entries(files)) {
    if (path === 'package.json') {
      try {
        const scripts = Object.values(JSON.parse(text).scripts || {});
        if (scripts.some((script) => typeof script === 'string' && /(?:^|\s)(?:dotenv|env-cmd)\b|\.env(?:\b|\.)/.test(script))) dynamicFiles.add(path);
      } catch { /* Project validation reports invalid package.json. */ }
    }
    if (includeTemplates && ENV_TEMPLATES.includes(path)) {
      for (const name of Object.keys(parseEnv(text).values)) add(name, path, 'template');
    }
    if (/\.html?$/.test(path)) {
      for (const match of text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/%([A-Z][A-Z0-9_]*)%/g)) add(match[1], path, 'vite');
    }
    if (!/\.[cm]?[jt]sx?$/.test(path) || /\.d\.[cm]?ts$/.test(path) || !/import\s*\.\s*meta|process|loadEnv|dotenv/.test(text)) continue;
    const visit = (node, parent) => {
      if (!node || typeof node !== 'object') return;
      const source = envObject(node);
      if ((node.type === 'CallExpression' && node.callee?.name === 'loadEnv')
        || (node.type === 'CallExpression' && node.callee?.name === 'require' && /^dotenv(?:\/|$)/.test(node.arguments?.[0]?.value || ''))
        || (node.type === 'ImportDeclaration' && /^dotenv(?:\/|$)/.test(node.source?.value || ''))) dynamicFiles.add(path);
      if (source) {
        if (parent?.type === 'MemberExpression' && parent.object === node) {
          const name = property(parent);
          if (name) add(name, path, source); else dynamicFiles.add(path);
        } else if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'ObjectPattern') {
          for (const item of parent.id.properties) {
            const name = item.computed ? item.key?.value : (item.key?.name || item.key?.value);
            if (typeof name === 'string') add(name, path, source); else dynamicFiles.add(path);
          }
        } else dynamicFiles.add(path);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((child) => visit(child, node));
        else if (value && typeof value === 'object') visit(value, node);
      }
    };
    try {
      const code = /\.[cm]?tsx?$/.test(path) ? transform(text, { transforms: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'], disableESTransforms: true }).code : text;
      visit(parser.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }), null);
    } catch {
      // Unparseable source still gets a prompt rather than silently losing settings.
      if (/import\s*\.\s*meta\s*\.\s*env|process\s*\.\s*env/.test(text)) dynamicFiles.add(path);
    }
  }
  return {
    detected: Boolean(variables.size || dynamicFiles.size || envFiles.length),
    variables: [...variables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    dynamicFiles: [...dynamicFiles],
    envFiles,
  };
}

export function environmentDraft(files, inspection) {
  const defaults = {};
  for (const path of [...ENV_TEMPLATES].reverse()) Object.assign(defaults, parseEnv(files[path]).values);
  return inspection.variables.filter((v) => v.public).map(({ name }) => {
    const value = defaults[name] || '';
    return `${name}=${value.includes('"') ? `'${value}'` : `"${value}"`}`;
  }).join('\n');
}

export function completeEnvironment(imported, draft) {
  const { values, invalidLines } = parseEnv(draft);
  if (invalidLines.length) throw new Error(`Check line ${invalidLines[0]}: each setting should look like VITE_NAME=value.`);
  const privateKey = Object.keys(values).find((name) => !name.startsWith('VITE_'));
  if (privateKey) throw new Error(`${privateKey} is a server setting. This preview supports public VITE_ settings. Choose the AI option for a standalone site.`);
  const unsupported = imported.environment.variables.find((v) => !v.public);
  if (unsupported) throw new Error(`${unsupported.name} needs a server or build setup that this preview cannot run. Choose the AI option to make the site editable here.`);
  const missing = imported.environment.variables.find((v) => !values[v.name]?.trim());
  if (missing) throw new Error(`Add a value for ${missing.name} before opening the site.`);
  if (!Object.keys(values).length) throw new Error('Add at least one public setting, such as VITE_API_URL=https://example.com.');
  const files = { ...imported.files, '.env.local': draft.trim() + '\n' };
  const limit = checkCodebaseLimits(files, imported.assets);
  if (limit) throw new Error(limit);
  return { ...imported, files, meta: { ...imported.meta, environmentResolution: 'manual' } };
}

export function environmentRemovalPrompt(inspection, files = {}) {
  // The generic editing context includes entry/layout files but often omits
  // the service clients that actually read settings. Supply those immediately.
  const paths = [...new Set([
    ...inspection.variables.flatMap((variable) => variable.files), ...inspection.dynamicFiles,
  ])].filter((path) => !isPrivateEnvPath(path) && !ENV_TEMPLATES.includes(path) && typeof files[path] === 'string');
  let budget = 24000;
  const sources = paths.map((path) => {
    const heading = `### ${path}`;
    if (files[path].length > budget) return `${heading}\n(Read this file with read_file; it contains environment-dependent code.)`;
    budget -= files[path].length;
    return `${heading}\n\`\`\`\n${files[path]}\n\`\`\``;
  }).join('\n\n');
  return `Make this imported website run and remain editable without any .env file or custom environment settings.\nDetected settings: ${inspection.variables.map((v) => v.name).join(', ') || 'unknown (inspect the source)'}.\nStart with the affected files below. Their contents are current and can be used directly as exact edit anchors. Read only additional files needed to understand consumers, then apply changes; do not repeatedly list or reread the project.\nInspect all uses, including computed accesses, destructuring, aliases, HTML placeholders, configuration and scripts. Replace environment-dependent services with working local/demo data and browser storage where appropriate. The preview never runs Node build scripts. If pages need generated blog indexes, posts or other content, create that data directly in project files and adapt the runtime to load it. Changing a generator script alone does not make the preview work. Preserve the API/data shape expected by existing pages, and handle empty content gracefully. Remove environment-dependent analytics and external service initialization, including their scripts in index.html when necessary. Keep the design, pages, navigation and editing experience. Do not invent credentials or embed secrets. Remove custom environment references and unused setup requirements from code, templates and documentation. Vite built-ins (MODE, DEV, PROD, SSR, BASE_URL) and process.env.NODE_ENV may stay. Live authentication, payments or backend features may become clearly labeled demo features. Finish only when the site builds without environment settings.\n\n## Current affected files\n${sources}`;
}
