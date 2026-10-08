import { JSX_TYPE, extractInlineScripts } from './syntaxCheck.js';
import { REACT_VERSION } from './jsxCompile.js';

const IMPORTMAP_TAG_RE = /<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script\s*>/i;

// "https://esm.sh/@scope/pkg@1.2.3/sub?x" -> ['@scope/pkg', '1.2.3']. Only
// esm.sh-style URLs carry a package name and version; anything else is skipped.
const packageFromUrl = (url) => {
  const m = /^https?:\/\/[^/]+\/((?:@[^/@]+\/)?[^/@?]+)@([^/?]+)/.exec(url || '');
  return m ? [m[1], m[2]] : null;
};

const readImportMap = (html) => {
  const tag = IMPORTMAP_TAG_RE.exec(html);
  if (!tag) return {};
  try {
    return JSON.parse(tag[1]).imports || {};
  } catch {
    return {};
  }
};

export const projectDependencies = (html) => {
  const deps = { react: `^${REACT_VERSION}`, 'react-dom': `^${REACT_VERSION}` };
  for (const url of Object.values(readImportMap(html))) {
    const pkg = packageFromUrl(url);
    if (!pkg) continue;
    const [name, version] = pkg;
    deps[name] = /^\d/.test(version) ? `^${version}` : version;
  }
  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
};

// The block sits indented inside <body>; as its own file it starts at column 0.
const dedent = (code) => {
  const lines = code.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(Math.min(cut, /^[ \t]*/.exec(l)[0].length))).join('\n') + '\n';
};

const README = (title) => `# ${title}

Made with AppBlips. This is a React project built with Vite.

## Run it

1. Install Node.js (LTS) from https://nodejs.org if you don't have it.
2. Open a terminal in this folder.
3. Type \`npm install\` and press Enter (only needed the first time).
4. Type \`npm run dev\` and press Enter.
5. Open the address it prints (usually http://localhost:5173) in your browser.

To make a version you can upload to a web host, run \`npm run build\`. The finished site is in the \`dist\` folder.
`;

// Turns a React app page (JSX in <script type="text/jsx">) into a Vite project:
// the JSX moves to src/main.jsx unchanged, the import map is replaced by npm
// dependencies, and everything else in the page (Tailwind CDN, styles,
// markup) stays in index.html. Returns zip entries, or null when the page has
// no JSX to move.
export const buildViteProject = (html, { name = 'app', title = 'My App' } = {}) => {
  const block = extractInlineScripts(html, { jsx: true }).find((b) => b.type === JSX_TYPE && !b.unclosed);
  if (!block) return null;

  const closeEnd = html.indexOf('>', block.endIdx) + 1;
  let indexHtml = html.slice(0, block.tagStart)
    + '<script type="module" src="/src/main.jsx"></script>'
    + html.slice(closeEnd);
  indexHtml = indexHtml.replace(IMPORTMAP_TAG_RE, '').replace(/\n[ \t]*\n(?=[ \t]*\n)/g, '\n');

  const packageJson = {
    name,
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: projectDependencies(html),
    devDependencies: { '@vitejs/plugin-react': '^6.0.1', vite: '^8.0.1' },
  };

  return [
    { name: `${name}/package.json`, data: JSON.stringify(packageJson, null, 2) + '\n' },
    {
      name: `${name}/vite.config.js`,
      data: "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n",
    },
    { name: `${name}/index.html`, data: indexHtml },
    { name: `${name}/src/main.jsx`, data: dedent(block.code) },
    { name: `${name}/README.md`, data: README(title) },
  ];
};
