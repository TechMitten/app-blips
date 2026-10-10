// Bundles the desktop app's main process (electron/main.js plus what it
// imports: the server handlers in electron/server, the project/provider stores
// and electron-updater) into one file, dist-electron/main.cjs. The packaged
// app then needs no node_modules at all; `electron` itself is provided by
// the runtime. Run by the npm desktop scripts before Electron starts.
// The desktop app is single-user, so nothing about a hosted backend is baked in.
import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: 'electron/main.js',
  platform: 'node',
  external: ['electron'],
  logLevel: 'warn',
});
// codeSplitting: false keeps it one file even though dependencies (the
// Anthropic SDK) contain dynamic imports.
await bundle.write({ file: 'dist-electron/main.cjs', format: 'cjs', codeSplitting: false });
await bundle.close();
console.log('Built dist-electron/main.cjs');
