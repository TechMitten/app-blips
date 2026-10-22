// Bundles the browser server (server.js plus electron/server and the Anthropic
// SDK it imports) into one file, dist-server/server.mjs, so the Docker image
// needs no node_modules. `npm start` runs server.js directly instead.
// Runs from the repo root; the bundle expects dist/ next to it, which is how
// the Dockerfile lays out /app.
import { rolldown } from 'rolldown';
import { licensePlugin } from './licenses.js';

const bundle = await rolldown({
  input: 'server.js',
  platform: 'node',
  logLevel: 'warn',
  // Checks the Settings → Licenses list covers what was bundled.
  plugins: [licensePlugin('server')],
});
// codeSplitting: false keeps it one file even though dependencies (the
// Anthropic SDK) contain dynamic imports.
await bundle.write({ file: 'dist-server/server.mjs', format: 'esm', codeSplitting: false });
await bundle.close();
console.log('Built dist-server/server.mjs');
