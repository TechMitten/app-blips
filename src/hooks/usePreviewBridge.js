import { useEffect } from 'react';
import { BRIDGE_CHANNEL, BRIDGE_PROTOCOL_VERSION } from '../previewBridge';
import { PREVIEW_MODES } from '../lib/constants';

// --- Preview bridge ---
// The preview iframe is origin-isolated (no `allow-same-origin`), so the parent
// can no longer touch its document. The mobile touch-scroll simulation now runs
// inside the frame (src/previewBridge.js); this effect just drives it.
export default function usePreviewBridge({
  iframeRef,
  previewSrcDoc,
  previewToken,
  previewMode,
  onRuntimeError,
  onReady,
  onStorageChange,
}) {
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !previewSrcDoc) return;

    const send = (type, payload) => {
      try {
        // targetOrigin '*' is required -- the frame's origin is opaque, so it
        // cannot know ours and we cannot address it by origin. Acceptable only
        // because no message in this protocol carries a secret. Do not add one.
        iframe.contentWindow?.postMessage(
          { __orion: BRIDGE_CHANNEL, v: BRIDGE_PROTOCOL_VERSION, token: previewToken, type, payload },
          '*'
        );
      } catch { /* frame torn down mid-send */ }
    };

    const push = () => send('configure', { enabled: PREVIEW_MODES[previewMode].isTouchChrome });

    // Belt-and-braces against the same compositor staleness that DeviceMockup's
    // "never display: none" comment describes: after a srcDoc navigation
    // Chromium can leave the frame's embedded surface stale (blank) even though
    // the new document rendered. Promoting the iframe to its own compositor
    // layer and dropping it again forces a re-rasterize. translateZ(0) is an
    // identity transform -- it does not scale -- so unlike `transform: scale()`
    // on the zoomed `.device-*` ancestor (see App.css) it cannot reintroduce
    // GPU-stretch blur.
    //
    // The revert is deliberately TWO frames out. A revert inside a single
    // requestAnimationFrame runs before that frame is painted, so the browser
    // coalesces the set and the unset and may never composite the promoted
    // layer at all -- i.e. the nudge silently does nothing. Waiting one painted
    // frame guarantees the promotion actually happens.
    const forceRepaint = () => {
      const el = iframeRef.current;
      if (!el) return;
      el.style.transform = 'translateZ(0)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (iframeRef.current === el) el.style.transform = '';
        });
      });
    };

    const onMessage = (event) => {
      // The frame's opaque origin makes event.origin the string "null", which is
      // worthless for authorization -- any sandboxed frame produces it.
      // WindowProxy identity is the actual boundary.
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      // The token only disambiguates a stale document from the current one. It is
      // NOT a secret: the generated app can read it out of its own DOM.
      if (!data || data.__orion !== BRIDGE_CHANNEL || data.token !== previewToken) return;
      if (data.type === 'ready') {
        push();
        forceRepaint();
        if (onReady) onReady({ token: previewToken });
      }
      else if (data.type === 'error') console.warn('[preview bridge]', data.payload?.message);
      else if (data.type === 'runtime_error' && onRuntimeError) onRuntimeError(data.payload);
      else if (
        (data.type === 'storage_set' || data.type === 'storage_remove' || data.type === 'storage_clear') &&
        onStorageChange
      ) {
        onStorageChange(data.type, data.payload);
      }
    };

    const handleLoad = () => {
      push();
      forceRepaint();
      if (onReady) onReady({ token: previewToken });
    };

    window.addEventListener('message', onMessage);
    // Three-way handshake: answer `ready`, re-push on load, and push once eagerly
    // for an already-loaded frame. Any one is sufficient; together they close the
    // race from both directions. `ready` and `load` each also nudge a repaint --
    // see forceRepaint above -- since a device-mode switch is otherwise the only
    // thing in the app that happens to force one.
    iframe.addEventListener('load', handleLoad);
    push();

    return () => {
      window.removeEventListener('message', onMessage);
      iframe.removeEventListener('load', handleLoad);
      // Toggling previewMode does NOT reload the frame -- React reconciles the
      // iframe in place -- so this message is what actually tears down the
      // listeners, injected styles and cursor inside it.
      send('configure', { enabled: false });
    };
  }, [previewSrcDoc, previewToken, previewMode, iframeRef, onRuntimeError, onReady, onStorageChange]);
}
