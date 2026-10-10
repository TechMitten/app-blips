// Plain-English labels for an imported project's files and folders, shown in
// the code view's file explorer. Users of the codebase studio are often not
// developers, so every common React + Vite file gets a one-line "what is
// this" instead of just its name.
import { extensionOf } from './paths.js';

const FILE_NOTES = [
  [/^package\.json$/, 'Lists the packages your site uses and its npm scripts'],
  [/^package-lock\.json$|^pnpm-lock\.yaml$|^yarn\.lock$|^bun\.lockb?$/, 'Exact package versions, managed automatically. No need to edit'],
  [/^index\.html$/, 'The page that loads your app in the browser'],
  [/^vite\.config\.[cm]?[jt]s$/, 'Settings for Vite, the tool that runs and builds the site'],
  [/^tsconfig(\..+)?\.json$/, 'TypeScript settings (how strict type checking is)'],
  [/^tailwind\.config\.[cm]?[jt]s$/, 'Tailwind CSS settings: colors, fonts, spacing'],
  [/^postcss\.config\.[cm]?[jt]s$/, 'PostCSS settings (processes the CSS)'],
  [/^eslint\.config\.[cm]?[jt]s$|^\.eslintrc/, 'Code style rules (ESLint)'],
  [/^components\.json$/, 'shadcn/ui settings for generated UI components'],
  [/^\.gitignore$/, 'Files Git should not track'],
  [/^readme\.md$/i, 'Notes about the project, written by its authors'],
  [/^\.env\.(example|sample|template)$/, 'Example settings (environment variables)'],
  [/^vite-env\.d\.ts$/, 'Type hints for Vite. Rarely edited'],
  [/^App\.[jt]sx?$/, 'The top-level component: usually the layout and pages'],
  [/^(main|index)\.[jt]sx?$/, 'Starts the app and puts it on the page'],
  [/^(index|globals?|app)\.css$/i, 'Site-wide styles'],
];

const FOLDER_NOTES = {
  src: 'Your app\'s source code',
  public: 'Images and files served exactly as they are',
  components: 'Reusable pieces of the interface',
  ui: 'Basic building blocks: buttons, inputs, cards',
  pages: 'One file per page of the site',
  routes: 'One file per page (route) of the site',
  views: 'Full screens of the app',
  hooks: 'Reusable React logic (hooks)',
  lib: 'Helper code shared across the app',
  utils: 'Small helper functions',
  assets: 'Images, icons and fonts used by the code',
  styles: 'Stylesheets',
  context: 'Shared app state (React context)',
  contexts: 'Shared app state (React context)',
  store: 'Shared app state',
  types: 'TypeScript type definitions',
  data: 'Content and data the site displays',
  services: 'Code that talks to servers and APIs',
  api: 'Code that talks to servers and APIs',
  layouts: 'Page layouts shared by several pages',
  sections: 'Large sections of a page',
};

const KIND_BY_EXT = {
  tsx: 'React component (TypeScript)', jsx: 'React component', ts: 'TypeScript code', js: 'JavaScript code',
  mjs: 'JavaScript code', cjs: 'JavaScript code', css: 'Styles', scss: 'Styles (Sass)', json: 'Data / settings',
  md: 'Text notes', html: 'Web page', svg: 'Vector image', png: 'Image', jpg: 'Photo', jpeg: 'Photo',
  gif: 'Animated image', webp: 'Image', avif: 'Image', ico: 'Site icon', woff: 'Font', woff2: 'Font',
  ttf: 'Font', otf: 'Font', mp4: 'Video', webm: 'Video', mp3: 'Audio', wav: 'Audio', pdf: 'PDF document',
  txt: 'Text file', yml: 'Settings', yaml: 'Settings', toml: 'Settings',
};

export function fileKind(path) {
  return KIND_BY_EXT[extensionOf(path)] || 'File';
}

export function describeFile(path, { entry } = {}) {
  if (path === entry) return 'Starts the app and puts it on the page';
  const name = path.split('/').pop();
  const dir = path.slice(0, -name.length - 1);
  for (const [re, note] of FILE_NOTES) {
    // Root config notes only apply at the root, and the App/main/css notes
    // only to the top of src/ (src/components/index.ts is not the app start).
    if (!re.test(name)) continue;
    const isSourceNote = /^(App|main|index|globals?|app)\./i.test(name);
    if (isSourceNote ? dir === 'src' : !dir) return note;
  }
  return fileKind(path);
}

export function describeFolder(path) {
  return FOLDER_NOTES[path.split('/').pop().toLowerCase()] || null;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'svg']);
const FONT_EXTS = new Set(['woff', 'woff2', 'ttf', 'otf', 'eot']);
const VIDEO_EXTS = new Set(['mp4', 'webm']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a']);

export function mediaKind(path) {
  const ext = extensionOf(path);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (FONT_EXTS.has(ext)) return 'font';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return null;
}

// Nested folder tree from flat paths: folders first, then files, each sorted
// case-insensitively, the way file managers list them.
export function buildFileTree(paths) {
  const root = { name: '', path: '', folders: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join('/');
      if (!node.folders.has(parts[i])) node.folders.set(parts[i], { name: parts[i], path: folderPath, folders: new Map(), files: [] });
      node = node.folders.get(parts[i]);
    }
    node.files.push(path);
  }
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  const finish = (node) => ({
    name: node.name,
    path: node.path,
    folders: [...node.folders.values()].sort((a, b) => byName(a.name, b.name)).map(finish),
    files: node.files.sort((a, b) => byName(a.split('/').pop(), b.split('/').pop())),
  });
  return finish(root);
}

// Every folder above a path: 'src/components/ui/button.tsx' ->
// ['src', 'src/components', 'src/components/ui'].
export function parentFolders(path) {
  const parts = String(path || '').split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

// Files the latest edit added or changed, compared with the version before.
export function changedFiles(files, assets, previousFiles, previousAssets) {
  const out = {};
  if (!previousFiles) return out;
  for (const [path, text] of Object.entries(files || {})) {
    if (!(path in previousFiles) && !previousAssets?.[path]) out[path] = 'added';
    else if (previousFiles[path] !== text) out[path] = 'modified';
  }
  for (const [path, hash] of Object.entries(assets || {})) {
    if (!previousAssets?.[path] && !(path in previousFiles)) out[path] = 'added';
    else if (previousAssets?.[path] && previousAssets[path] !== hash) out[path] = 'modified';
  }
  return out;
}
