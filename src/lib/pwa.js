// Progressive Web App (PWA) utilities for published sites.
// When enabled, published sites get a Web App Manifest, a Service Worker for
// offline caching and installability, and an in-page notification prompting
// visitors to install the site on their device.

export const FALLBACK_PWA_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAVUlEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvBhj5gABl4N72AAAAABJRU5ErkJggg==';

const escapeHtml = (str) => String(str ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const escapeAttr = escapeHtml;

/**
 * Returns a base64 PNG icon for the PWA manifest and site icon.
 * In a browser with Canvas support, draws an indigo rounded icon with the site initial.
 * In node or non-DOM environments, returns a fallback PNG base64 string.
 */
export function defaultPwaIconBase64(name) {
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const r = 40;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(192 - r, 0);
        ctx.quadraticCurveTo(192, 0, 192, r);
        ctx.lineTo(192, 192 - r);
        ctx.quadraticCurveTo(192, 192, 192 - r, 192);
        ctx.lineTo(r, 192);
        ctx.quadraticCurveTo(0, 192, 0, 192 - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fillStyle = '#4f46e5';
        ctx.fill();

        const letter = (name || 'A').trim().charAt(0).toUpperCase() || 'A';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 96px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter, 96, 102);

        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.startsWith('data:image/png;base64,')) {
          return dataUrl.slice(22);
        }
      }
    } catch {
      // Fallback below
    }
  }
  return FALLBACK_PWA_ICON_BASE64;
}

/**
 * Generates web manifest JSON text for PWA installation.
 */
export function buildPwaManifest(projectName) {
  const name = (projectName || 'App').trim() || 'App';
  const shortName = name.length > 12 ? name.slice(0, 12).trim() : name;
  return JSON.stringify({
    name,
    short_name: shortName,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#4f46e5',
    icons: [
      {
        src: '/favicon.png',
        sizes: '192x192 512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  }, null, 2);
}

/**
 * Generates the minimal service worker for PWA installability and offline caching.
 */
export function buildServiceWorker() {
  return `// AppBlips PWA Service Worker
const CACHE_NAME = 'appblips-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
`;
}

/**
 * Builds the notification banner HTML, CSS, and interactive script.
 */
export function buildPwaNotificationHtml(projectName) {
  const name = (projectName || 'App').trim() || 'App';
  return `<!-- AppBlips PWA Installation Prompt -->
<style>
#appblips-pwa-prompt {
  position: fixed;
  bottom: max(16px, env(safe-area-inset-bottom, 16px));
  left: 16px;
  right: 16px;
  margin: 0 auto;
  max-width: 440px;
  z-index: 2147483647;
  background: rgba(15, 23, 42, 0.96);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: #f8fafc;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 16px;
  box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06);
  padding: 14px 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: appblips-pwa-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes appblips-pwa-slide-in {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes appblips-pwa-fade-out {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(16px); opacity: 0; }
}
.appblips-pwa-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.appblips-pwa-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  overflow: hidden;
  background: #1e293b;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.appblips-pwa-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.appblips-pwa-fallback-icon {
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: #818cf8;
}
.appblips-pwa-text {
  flex: 1;
  min-width: 0;
}
.appblips-pwa-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.3;
}
.appblips-pwa-desc {
  margin: 2px 0 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}
.appblips-pwa-guide {
  margin: 6px 0 0;
  padding: 6px 8px;
  background: rgba(79, 70, 229, 0.15);
  border: 1px solid rgba(129, 140, 248, 0.35);
  border-radius: 6px;
  font-size: 12px;
  color: #e0e7ff;
  line-height: 1.35;
}
.appblips-pwa-close {
  background: transparent;
  border: none;
  color: #94a3b8;
  padding: 2px;
  cursor: pointer;
  border-radius: 4px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.appblips-pwa-close:hover {
  color: #ffffff;
}
.appblips-pwa-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.appblips-pwa-btn {
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: opacity 0.15s, background-color 0.15s;
}
.appblips-pwa-btn-primary {
  background: #4f46e5;
  color: #ffffff;
}
.appblips-pwa-btn-primary:hover {
  background: #4338ca;
}
.appblips-pwa-btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}
.appblips-pwa-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
}
</style>
<aside id="appblips-pwa-prompt" role="dialog" aria-labelledby="appblips-pwa-title" aria-describedby="appblips-pwa-desc" style="display:none">
  <div class="appblips-pwa-main">
    <div class="appblips-pwa-icon-wrap">
      <img src="/favicon.png" alt="" class="appblips-pwa-icon" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="appblips-pwa-fallback-icon" style="display:none">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
          <path d="M12 18h.01"/>
        </svg>
      </div>
    </div>
    <div class="appblips-pwa-text">
      <h3 id="appblips-pwa-title" class="appblips-pwa-title">Install ${escapeHtml(name)}</h3>
      <p id="appblips-pwa-desc" class="appblips-pwa-desc">Install this site as an app on your device for quick access and full-screen use.</p>
      <p id="appblips-pwa-guide" class="appblips-pwa-guide" style="display:none"></p>
    </div>
    <button type="button" id="appblips-pwa-close" class="appblips-pwa-close" aria-label="Dismiss">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>
  <div class="appblips-pwa-actions">
    <button type="button" id="appblips-pwa-dismiss" class="appblips-pwa-btn appblips-pwa-btn-secondary">Not now</button>
    <button type="button" id="appblips-pwa-install" class="appblips-pwa-btn appblips-pwa-btn-primary">Install</button>
  </div>
</aside>
<script>
(function() {
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator && window.navigator.standalone === true) return;
  var STORAGE_KEY = 'appblips-pwa-dismissed';
  try {
    if (sessionStorage.getItem(STORAGE_KEY)) return;
  } catch (e) {}

  var deferredPrompt = null;
  var promptEl = document.getElementById('appblips-pwa-prompt');
  var installBtn = document.getElementById('appblips-pwa-install');
  var dismissBtn = document.getElementById('appblips-pwa-dismiss');
  var closeBtn = document.getElementById('appblips-pwa-close');
  var guideEl = document.getElementById('appblips-pwa-guide');

  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  window.addEventListener('appinstalled', function() {
    if (promptEl) promptEl.remove();
  });

  function dismiss() {
    try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
    if (promptEl) {
      promptEl.style.animation = 'appblips-pwa-fade-out 0.2s ease forwards';
      setTimeout(function() { if (promptEl) promptEl.remove(); }, 200);
    }
  }

  if (dismissBtn) dismissBtn.addEventListener('click', dismiss);
  if (closeBtn) closeBtn.addEventListener('click', dismiss);

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  if (installBtn) {
    installBtn.addEventListener('click', function() {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function(choice) {
          if (choice && choice.outcome === 'accepted') {
            dismiss();
          }
          deferredPrompt = null;
        });
      } else if (isIOS) {
        if (guideEl) {
          guideEl.style.display = 'block';
          guideEl.innerHTML = 'Tap the Share icon <svg style="display:inline-block;vertical-align:-2px;margin:0 2px" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> below, then choose <strong>Add to Home Screen</strong>.';
          installBtn.style.display = 'none';
        }
      } else {
        if (guideEl) {
          guideEl.style.display = 'block';
          guideEl.textContent = "Open your browser menu (\\u22ee or \\u22ef) and choose 'Install app' or 'Add to Home screen'.";
          installBtn.style.display = 'none';
        }
      }
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function() {});
    });
  }

  setTimeout(function() {
    if (promptEl) promptEl.style.display = 'flex';
  }, 1000);
})();
</script>`;
}

/**
 * Injects PWA manifest links, meta tags, and the install notification into an HTML page.
 */
export function injectPwaPrompt(html, { projectName = '' } = {}) {
  if (typeof html !== 'string') return html;

  const manifestLinks = `<link rel="manifest" href="/manifest.webmanifest">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">\n<meta name="apple-mobile-web-app-title" content="${escapeAttr(projectName || 'App')}">\n<meta name="theme-color" content="#4f46e5">\n`;

  // Remove any existing manifest links to avoid collision
  const cleanHtml = html.replace(/<link\b[^>]*\brel\s*=\s*(?:"manifest"|'manifest'|manifest)[^>]*>[ \t]*\n?/gi, '');

  let withHead = cleanHtml;
  const headEnd = withHead.search(/<\/head\s*>/i);
  if (headEnd !== -1) {
    withHead = withHead.slice(0, headEnd) + manifestLinks + withHead.slice(headEnd);
  } else {
    const headOpen = /<head\b[^>]*>\s*/i.exec(withHead);
    if (headOpen) {
      const at = headOpen.index + headOpen[0].length;
      withHead = withHead.slice(0, at) + manifestLinks + withHead.slice(at);
    } else {
      const htmlOpen = /<html\b[^>]*>\s*/i.exec(withHead);
      if (htmlOpen) {
        const at = htmlOpen.index + htmlOpen[0].length;
        withHead = withHead.slice(0, at) + `<head>\n${manifestLinks}</head>\n` + withHead.slice(at);
      } else {
        const doctype = /^\s*<!doctype[^>]*>\s*/i.exec(withHead);
        const at = doctype ? doctype[0].length : 0;
        withHead = withHead.slice(0, at) + manifestLinks + withHead.slice(at);
      }
    }
  }

  const notificationSnippet = buildPwaNotificationHtml(projectName);

  const bodyEnd = withHead.search(/<\/body\s*>/i);
  if (bodyEnd !== -1) {
    return withHead.slice(0, bodyEnd) + notificationSnippet + '\n' + withHead.slice(bodyEnd);
  }

  return withHead + '\n' + notificationSnippet;
}
