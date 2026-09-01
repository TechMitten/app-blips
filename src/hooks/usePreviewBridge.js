import { useEffect } from 'react';
import { BRIDGE_CHANNEL, BRIDGE_PROTOCOL_VERSION } from '../previewBridge';
import { PREVIEW_MODES } from '../lib/constants';

// --- Preview bridge ---
// The preview iframe is origin-isolated (no `allow-same-origin`), so the parent
// can no longer touch its document. The mobile touch-scroll simulation now runs
// inside the frame (src/previewBridge.js); this effect just drives it.
export default function usePreviewBridge({ iframeRef, previewSrcDoc, previewToken, previewMode }) {
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

    const onMessage = (event) => {
      // The frame's opaque origin makes event.origin the string "null", which is
      // worthless for authorization -- any sandboxed frame produces it.
      // WindowProxy identity is the actual boundary.
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      // The token only disambiguates a stale document from the current one. It is
      // NOT a secret: the generated app can read it out of its own DOM.
      if (!data || data.__orion !== BRIDGE_CHANNEL || data.token !== previewToken) return;
      if (data.type === 'ready') push();
      else if (data.type === 'error') console.warn('[preview bridge]', data.payload?.message);
    };

    window.addEventListener('message', onMessage);
    // Three-way handshake: answer `ready`, re-push on load, and push once eagerly
    // for an already-loaded frame. Any one is sufficient; together they close the
    // race from both directions.
    iframe.addEventListener('load', push);
    push();

    return () => {
      window.removeEventListener('message', onMessage);
      iframe.removeEventListener('load', push);
      // Toggling previewMode does NOT reload the frame -- React reconciles the
      // iframe in place -- so this message is what actually tears down the
      // listeners, injected styles and cursor inside it.
      send('configure', { enabled: false });
    };
  }, [previewSrcDoc, previewToken, previewMode, iframeRef]);
}
