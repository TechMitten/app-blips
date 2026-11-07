// `npm run dev`: Vite, plus the Cloudflare Tunnel that serves it at
// https://dev.appblips.com (production Clerk sign-in refuses localhost; see
// server.allowedHosts in vite.config.js). The tunnel runs only while Vite
// does: stopping Vite (Ctrl+C, closing the terminal, or Vite exiting on its
// own) stops it too.
//
// Machines without the tunnel's config or without cloudflared on PATH (other
// contributors, Pinokio) just get Vite, as before. Arguments are passed to
// Vite (`npm run dev -- --host`).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TUNNEL_CONFIG = join(homedir(), '.cloudflared', 'appblips-dev.yml');

const hasCloudflared = () => spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).status === 0;

const vite = spawn(process.execPath, [join('node_modules', 'vite', 'bin', 'vite.js'), ...process.argv.slice(2)], { stdio: 'inherit' });

let tunnel = null;
let stopping = false;
if (!existsSync(TUNNEL_CONFIG)) {
  console.log(`[dev] No tunnel config at ${TUNNEL_CONFIG}: running without dev.appblips.com.`);
} else if (!hasCloudflared()) {
  console.log('[dev] cloudflared is not installed: running without dev.appblips.com.');
} else {
  // Its log goes to stderr; only errors are worth showing next to Vite's.
  // Its usual warnings don't matter for serving a web page: no ICMP (ping)
  // proxy for a user outside ping_group_range, and a smaller UDP buffer than
  // QUIC wants (printed by quic-go itself, hence the variable).
  tunnel = spawn('cloudflared', ['tunnel', '--loglevel', 'error', '--config', TUNNEL_CONFIG, 'run'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, QUIC_GO_DISABLE_RECEIVE_BUFFER_WARNING: 'true' },
  });
  console.log('[dev] Cloudflare Tunnel starting: https://dev.appblips.com');
  tunnel.on('exit', (code, signal) => {
    tunnel = null;
    if (!stopping) console.log(`[dev] Cloudflare Tunnel stopped (${signal || `exit ${code}`}). Vite keeps running on localhost.`);
  });
  tunnel.on('error', (err) => console.log(`[dev] Could not start cloudflared: ${err.message}`));
}

const stopTunnel = () => {
  stopping = true;
  if (tunnel) tunnel.kill('SIGTERM');
};

vite.on('exit', (code, signal) => {
  stopTunnel();
  process.exitCode = code ?? (signal ? 1 : 0);
});

// Ctrl+C reaches every process in the terminal's group, Vite included; a
// signal sent to this script alone (closing the terminal, kill) is passed on
// so nothing is left behind.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopTunnel();
    if (vite.exitCode === null && vite.signalCode === null) vite.kill(sig);
  });
}
