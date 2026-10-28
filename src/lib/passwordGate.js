// Password protection for a published site. Surge only serves static files,
// so there is no server to check a password on. Instead every page is
// encrypted before it leaves the machine (AES-256-GCM, key from the password
// with PBKDF2-SHA-256) and the published page is a small lock screen holding
// only the ciphertext. The visitor's browser derives the key from what they
// type and decrypts. Neither the password nor the project's code is ever in
// what is published; a wrong password fails GCM's authentication tag, so
// there is no stored check value to attack either.
//
// The limit of this design: anyone can download the ciphertext and guess
// passwords offline, with no rate limit. The iteration count slows each guess
// and MIN_GATE_PASSWORD_LENGTH rules out the easiest passwords, but the
// password's own strength is what protects the site.
//
// WebCrypto only (no DOM, no Node APIs), so surgeApi.js runs it in every host
// and the test runs it in Node.

export const MIN_GATE_PASSWORD_LENGTH = 10;
export const MAX_GATE_PASSWORD_LENGTH = 256;
// OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Stored in each page so it can be
// raised later without breaking sites already published.
export const GATE_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;

// Rejects with a message the Publish window can show as it is.
export const checkGatePassword = (password) => {
  if (typeof password !== 'string') return 'Enter a password for your site.';
  if (password.length < MIN_GATE_PASSWORD_LENGTH) return `Use at least ${MIN_GATE_PASSWORD_LENGTH} characters for the site password.`;
  if (password.length > MAX_GATE_PASSWORD_LENGTH) return 'That site password is too long.';
  return null;
};

const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// NFKC so the same password typed on another keyboard or device still matches.
const passwordBytes = (password) => new TextEncoder().encode(password.normalize('NFKC'));

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', passwordBytes(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, 256);
  const bytes = new Uint8Array(bits);
  return { bytes, key: await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']) };
}

// The lock screen runs as a classic script on purpose: a module script would
// stop the decrypted page's own import map from taking effect. Once the
// page is decrypted it replaces this document, so relative links, scripts and
// the address bar behave as if it had been published unlocked. The derived key
// (never the password) is kept in sessionStorage for the tab, so the visitor
// unlocks once and the site's other pages open without asking again.
const GATE_SCRIPT = `(function () {
  var data = JSON.parse(document.getElementById('appblips-gate-data').textContent);
  var STORE = 'appblips-gate-key';
  var form = document.getElementById('gate-form');
  var input = document.getElementById('gate-password');
  var button = document.getElementById('gate-submit');
  var note = document.getElementById('gate-note');
  var bytes = function (text) {
    var binary = atob(text), out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  };
  var show = function (html) { document.open(); document.write(html); document.close(); };
  var decrypt = function (raw) {
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(data.iv) }, key, bytes(data.ct));
    }).then(function (plain) { return new TextDecoder().decode(plain); });
  };
  var say = function (text) { note.textContent = text; };
  if (!window.crypto || !crypto.subtle) {
    say('This page needs a secure connection (https) to unlock.');
    button.disabled = true;
    input.disabled = true;
    return;
  }
  var saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(STORE)); } catch (e) {}
  if (saved && saved.salt === data.salt && typeof saved.key === 'string') {
    decrypt(bytes(saved.key)).then(show, function () {
      try { sessionStorage.removeItem(STORE); } catch (e) {}
    });
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!input.value) return;
    button.disabled = true;
    input.disabled = true;
    say('Unlocking…');
    crypto.subtle.importKey('raw', new TextEncoder().encode(input.value.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']).then(function (material) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: bytes(data.salt), iterations: data.iterations, hash: 'SHA-256' }, material, 256);
    }).then(function (bits) {
      var raw = new Uint8Array(bits);
      return decrypt(raw).then(function (html) {
        var text = '';
        for (var i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]);
        try { sessionStorage.setItem(STORE, JSON.stringify({ salt: data.salt, key: btoa(text) })); } catch (e) {}
        show(html);
      });
    }).then(null, function () {
      say('That password isn’t right. Try again.');
      button.disabled = false;
      input.disabled = false;
      input.value = '';
      input.focus();
    });
  });
})();`;

const GATE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
  main { width: 100%; max-width: 22rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 1rem; padding: 1.75rem; box-shadow: 0 10px 30px rgb(15 23 42 / .08); }
  h1 { margin: 0 0 .25rem; font-size: 1.125rem; }
  p { margin: 0 0 1rem; font-size: .875rem; color: #475569; }
  input, button { width: 100%; font: inherit; font-size: .9375rem; border-radius: .6rem; padding: .6rem .75rem; }
  input { border: 1px solid #cbd5e1; background: #fff; color: inherit; }
  button { margin-top: .75rem; border: 0; background: #4f46e5; color: #fff; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  #gate-note { margin: .75rem 0 0; min-height: 1.25rem; font-size: .8125rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f172a; color: #f1f5f9; }
    main { background: #1e293b; border-color: #334155; box-shadow: none; }
    p { color: #94a3b8; }
    input { background: #0f172a; border-color: #475569; }
  }`;

// A neutral title and a noindex tag: the project's own title and description
// are part of what is encrypted.
const gatePage = ({ salt, iv, ct }) => {
  const data = JSON.stringify({ v: 1, iterations: GATE_ITERATIONS, salt, iv, ct });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Password required</title>
<style>${GATE_STYLE}</style>
</head>
<body>
<main>
<h1>This site is password protected</h1>
<p>Type the password to open it.</p>
<form id="gate-form">
<input id="gate-password" type="password" autocomplete="current-password" aria-label="Password" autofocus required>
<button id="gate-submit" type="submit">Unlock</button>
<p id="gate-note" role="status" aria-live="polite"></p>
</form>
<noscript><p>Turn on JavaScript to unlock this page.</p></noscript>
</main>
<script type="application/json" id="appblips-gate-data">${data}</script>
<script>${GATE_SCRIPT}</script>
</body>
</html>
`;
};

// { 'index.html': html } -> the same names, each one a lock screen holding
// that page encrypted. One salt for the whole site (so one unlock opens every
// page), a fresh random IV for every page.
export async function protectPages(files, password) {
  const problem = checkGatePassword(password);
  if (problem) throw new Error(problem);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const { key } = await deriveKey(password, salt, GATE_ITERATIONS);
  const out = {};
  for (const [name, html] of Object.entries(files)) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(html)));
    out[name] = gatePage({ salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(ct) });
  }
  return out;
}

// Pages with each image built in as a data: URL, so the pictures are inside
// the encrypted pages too instead of sitting in the open at images/<name>.
// images: [{ path: 'images/a.jpg', type: 'image/jpeg', bytes }]
export const inlineGateImages = (files, images) => {
  if (!images.length) return files;
  const urls = new Map(images.map(({ path, type, bytes }) => [path, `data:${type};base64,${toBase64(bytes)}`]));
  const escaped = [...urls.keys()].map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Not followed by a name character, so images/a.png never matches inside images/a.png2.
  const re = new RegExp(`(?<![A-Za-z0-9._/-])(?:\\./|/)?(${escaped.join('|')})(?![A-Za-z0-9._-])`, 'g');
  return Object.fromEntries(Object.entries(files).map(([name, html]) => [name, html.replace(re, (_, path) => urls.get(path))]));
};
