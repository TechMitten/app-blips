// Third-party license credits for Settings → Licenses. Each build (the
// renderer and its voice-input worker, the desktop main process, the Docker
// server) reports the npm packages that actually ended up in its bundle, so
// the list is exactly what ships, not everything in package.json.
//
// The result is committed as src/lib/thirdPartyLicenses.json so `npm run dev`
// shows it too. Normal builds only check that file and fail when it no longer
// matches the bundle (a dependency was added, removed or updated), which keeps
// CI and releases from shipping stale credits. `npm run licenses`
// (scripts/update-licenses.js) reruns the builds with
// APPBLIPS_UPDATE_LICENSES=1 to rewrite it.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LICENSES_FILE = join(ROOT, 'src', 'lib', 'thirdPartyLicenses.json');

const PART_LABELS = { app: 'app', desktop: 'desktop main process', server: 'browser server' };

// Shipped, but not reached through the bundle's module graph.
const ALWAYS = {
  app: ['tailwindcss'], // compiled into the stylesheet by PostCSS
  desktop: ['electron'], // the runtime itself; external to the main bundle
  server: [],
};

// Shipped, but not npm packages. `textFrom` borrows a package's license file
// that holds the same license's full text.
const EXTRAS = [
  {
    name: 'Whisper base (voice input model)',
    author: 'OpenAI; ONNX conversion by onnx-community',
    license: 'Apache-2.0',
    homepage: 'https://huggingface.co/openai/whisper-base',
    textFrom: '@huggingface/transformers/LICENSE',
  },
];

// The package a bundled module belongs to: the last node_modules/<name>
// segment of its id, so nested copies resolve to their own version.
const packageDir = (id) => {
  const path = id.replace(/^\0/, '').split('?')[0].replace(/\\/g, '/');
  const match = path.match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)/);
  return match ? match[1] : null;
};

const LICENSE_FILE_RE = /^(licen[cs]e|copying|notice)([.\-_].*)?$/i;

const readLicenseText = (dir) => readdirSync(dir)
  .filter((file) => LICENSE_FILE_RE.test(file))
  // License before NOTICE, which Apache-2.0 packages must ship alongside it.
  .sort((a, b) => /^notice/i.test(a) - /^notice/i.test(b) || a.localeCompare(b))
  .map((file) => readFileSync(join(dir, file), 'utf8').trim())
  .join('\n\n');

// package.json repository fields come in several git forms; the settings tab
// needs a web link, so anything that isn't one after normalizing is dropped.
const repoUrl = (repository) => {
  const url = (typeof repository === 'string' ? repository : repository?.url || '')
    .replace(/^git\+/, '')
    .replace(/^(?:github:)?([\w.-]+\/[\w.-]+)$/, 'https://github.com/$1')
    .replace(/^(?:ssh:\/\/)?git@([^:/]+)[:/]/, 'https://$1/')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
  return /^https?:\/\//.test(url) ? url : '';
};

const describePackage = (dir) => {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const license = typeof pkg.license === 'string'
    ? pkg.license
    : pkg.license?.type || (pkg.licenses || []).map((l) => l.type).join(' OR ') || 'Unknown';
  return {
    name: pkg.name,
    version: pkg.version,
    license,
    author: typeof pkg.author === 'string' ? pkg.author.replace(/\s*[<(].*$/, '') : pkg.author?.name || '',
    homepage: (/^https?:\/\//.test(pkg.homepage || '') && pkg.homepage) || repoUrl(pkg.repository),
    text: readLicenseText(dir),
  };
};

const keyOf = ({ name, version }) => `${name}@${version}`;

const readFile = () => (existsSync(LICENSES_FILE) ? JSON.parse(readFileSync(LICENSES_FILE, 'utf8')) : null);

// Checks (or, with APPBLIPS_UPDATE_LICENSES=1, rewrites) one part's packages.
export function syncLicenses(part, dirs) {
  const fresh = [...new Set([...dirs, ...ALWAYS[part].map((name) => join(ROOT, 'node_modules', name))])]
    .map(describePackage);
  const keys = [...new Set(fresh.map(keyOf))].sort();
  const current = readFile();

  if (process.env.APPBLIPS_UPDATE_LICENSES !== '1') {
    const listed = current?.parts?.[part] || [];
    const added = keys.filter((key) => !listed.includes(key));
    const removed = listed.filter((key) => !keys.includes(key));
    if (added.length || removed.length) {
      throw new Error(
        `The third-party license list for the ${PART_LABELS[part]} is out of date`
        + `${added.length ? `\n  new: ${added.join(', ')}` : ''}${removed.length ? `\n  gone: ${removed.join(', ')}` : ''}`
        + `\nRun "npm run licenses" and commit ${relative(ROOT, LICENSES_FILE)}.`,
      );
    }
    return;
  }

  const parts = { ...current?.parts, [part]: keys };
  const wanted = new Set(Object.values(parts).flat());
  const byKey = new Map((current?.packages || []).map((entry) => [keyOf(entry), entry]));
  for (const entry of fresh) byKey.set(keyOf(entry), entry);
  const packages = [...byKey.values()]
    .filter((entry) => wanted.has(keyOf(entry)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const extras = EXTRAS.map(({ textFrom, ...extra }) => ({
    ...extra,
    text: readFileSync(join(ROOT, 'node_modules', textFrom), 'utf8').trim(),
  }));
  const appblips = readFileSync(join(ROOT, 'LICENSE'), 'utf8').trim();
  writeFileSync(LICENSES_FILE, `${JSON.stringify({ appblips, parts, packages, extras }, null, 2)}\n`);
  console.log(`Updated ${relative(ROOT, LICENSES_FILE)} (${PART_LABELS[part]}: ${keys.length} packages)`);
}

// A Rollup/Rolldown/Vite plugin that collects the bundled packages into
// `collected` and, unless `finish` is false (Vite's worker builds, which feed
// the app's collection), syncs them when the bundle closes.
export function licensePlugin(part, { collected = new Set(), finish = true } = {}) {
  return {
    name: 'appblips-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        for (const id of file.moduleIds || []) {
          const dir = packageDir(id);
          if (dir) collected.add(dir);
        }
      }
    },
    closeBundle() {
      if (finish) syncLicenses(part, collected);
    },
  };
}
