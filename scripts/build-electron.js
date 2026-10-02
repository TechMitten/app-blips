// Bundles the desktop app's main process (electron/main.js plus what it
// imports: the server handlers in functions/_lib, the project/provider stores
// and electron-updater) into one file, dist-electron/main.cjs. The packaged
// app then needs no node_modules at all; `electron` itself is provided by
// the runtime. Run by the npm desktop scripts before Electron starts.
import { rolldown } from 'rolldown';
import { loadEnv } from 'vite';

// Public Supabase config baked into the main-process bundle so a multi-user
// desktop build can verify Supabase tokens on /api/chat (and the config
// summary reflects the real mode). Only the URL and publishable key are baked
// -- both are public. The service role key is deliberately NOT baked (secret).
const env = { ...loadEnv('desktop', process.cwd(), ''), ...process.env };
const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
const supabasePublishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

const bundle = await rolldown({
  input: 'electron/main.js',
  platform: 'node',
  external: ['electron'],
  logLevel: 'warn',
  transform: {
    define: {
      __APPBLIPS_SUPABASE_URL__: JSON.stringify(supabaseUrl),
      __APPBLIPS_SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabasePublishableKey),
    },
  },
});
await bundle.write({ file: 'dist-electron/main.cjs', format: 'cjs' });
await bundle.close();
console.log('Built dist-electron/main.cjs');
