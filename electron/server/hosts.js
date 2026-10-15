// DNS rebinding: a web page on evil.example can point its own name at
// 127.0.0.1, and its requests then carry a matching Host and Origin, so
// isForeignOrigin alone can't tell them apart from AppBlips. Only names that
// mean this computer pass, plus any the user lists (a LAN name or a reverse
// proxy's domain). Shared by server.js and the Vite dev server.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export const hostAllowed = (hostHeader, env = process.env) => {
  let hostname = '';
  try { hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase(); } catch { return false; }
  const extraHosts = String(env.APPBLIPS_ALLOWED_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || extraHosts.includes(hostname);
};
