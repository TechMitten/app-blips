// npm run licenses: rebuilds the app, the desktop main process and the browser
// server with APPBLIPS_UPDATE_LICENSES=1, so each rewrites its part of
// src/lib/thirdPartyLicenses.json (see scripts/licenses.js). Run it after
// adding, removing or updating a dependency, then commit the JSON.
import { execFileSync } from 'node:child_process';

const env = { ...process.env, APPBLIPS_UPDATE_LICENSES: '1' };
const run = (...args) => execFileSync(process.execPath, args, { stdio: 'inherit', env });

run('node_modules/vite/bin/vite.js', 'build', '--mode', 'desktop');
run('scripts/build-electron.js');
run('scripts/build-server.js');
