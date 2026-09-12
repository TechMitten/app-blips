import { useCallback, useEffect, useRef } from 'react';
import { BRIDGE_CHANNEL, BRIDGE_PROTOCOL_VERSION } from '../previewBridge';
import { PREVIEW_MODES } from '../lib/constants';
import { rasterizeDomSnapshot } from '../lib/attachments';
import { requestModelText } from '../lib/llm';

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
  aiEnabled = false,
}) {
  const onRuntimeErrorRef = useRef(onRuntimeError);
  const onReadyRef = useRef(onReady);
  const onStorageChangeRef = useRef(onStorageChange);
  const recentTokensRef = useRef(new Set(previewToken ? [previewToken] : []));
  // The token of the document the iframe is navigating TO. `send` reads this
  // ref instead of closing over the prop so a `load` handler attached by a
  // PREVIOUS effect run still addresses the frame with the live token: a
  // srcdoc document can finish loading before passive effects re-attach (the
  // heavy commit when a generation completes is exactly that race), and a
  // configure pushed with a stale token is silently rejected by the new
  // document. The frame no longer NEEDS that push to boot configured (the
  // touch state is baked in at injection time -- see injectPreviewBridge),
  // but every push that does go out should be deliverable.
  const currentTokenRef = useRef(previewToken);
  // Set inside the effect below on every run, so requestScreenshot (called
  // imperatively, outside that effect) always addresses the live frame.
  const sendRef = useRef(() => {});
  // requestId -> { resolve, reject, timeoutId }, for correlating the one
  // request/response pair in this otherwise push-only protocol.
  const pendingCapturesRef = useRef(new Map());

  useEffect(() => {
    onRuntimeErrorRef.current = onRuntimeError;
    onReadyRef.current = onReady;
    onStorageChangeRef.current = onStorageChange;
    currentTokenRef.current = previewToken;
  });

  // Reject any still-pending screenshot request on unmount so its promise
  // doesn't hang forever.
  useEffect(() => () => {
    pendingCapturesRef.current.forEach(({ reject, timeoutId }) => {
      clearTimeout(timeoutId);
      reject(new Error('Preview unmounted before the screenshot was captured.'));
    });
    pendingCapturesRef.current.clear();
  }, []);

  // Ensure the live token is registered synchronously to prevent race conditions
  // where the sandboxed frame loads and messages before effects commit.
  if (previewToken && !recentTokensRef.current.has(previewToken)) {
    recentTokensRef.current.add(previewToken);
    if (recentTokensRef.current.size > 10) {
      const oldestToken = recentTokensRef.current.values().next().value;
      recentTokensRef.current.delete(oldestToken);
    }
  }

  useEffect(() => {
    if (previewToken) {
      recentTokensRef.current.add(previewToken);
      if (recentTokensRef.current.size > 10) {
        const oldestToken = recentTokensRef.current.values().next().value;
        recentTokensRef.current.delete(oldestToken);
      }
    }
  }, [previewToken]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !previewSrcDoc) return;

    const send = (type, payload, token = currentTokenRef.current) => {
      try {
        // targetOrigin '*' is required -- the frame's origin is opaque, so it
        // cannot know ours and we cannot address it by origin. Acceptable only
        // because no message in this protocol carries a secret. Do not add one.
        // token: see the currentTokenRef comment above -- a stale `load`
        // handler must address the frame with the CURRENT token or the
        // freshly-navigated document silently rejects the configure.
        iframe.contentWindow?.postMessage(
          { __orion: BRIDGE_CHANNEL, v: BRIDGE_PROTOCOL_VERSION, token, type, payload },
          '*'
        );
      } catch { /* frame torn down mid-send */ }
    };
    sendRef.current = send;

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
      if (!data || data.__orion !== BRIDGE_CHANNEL) return;
      if (!recentTokensRef.current.has(data.token)) return;

      if (data.type === 'ready') {
        push();
        forceRepaint();
        if (onReadyRef.current) onReadyRef.current({ token: data.token });
      }
      else if (data.type === "ai-chat-request") {
        const requestId = data.payload?.requestId;
        if (!aiEnabled || !requestId || !Array.isArray(data.payload?.messages)) {
          send("ai-chat-error", { requestId, code: "unauthorized", message: "AI capabilities are disabled." }, data.token);
          return;
        }
        const messages = data.payload.messages.slice(0, 64).map((message) => ({
          role: ["system", "user", "assistant"].includes(message?.role) ? message.role : "user",
          content: typeof message?.content === "string" ? message.content : String(message?.content ?? ""),
        }));
        requestModelText({
          messages,
          onChunk: (chunk, kind) => {
            if (kind === "content") send("ai-chat-chunk", { requestId, text: chunk }, data.token);
          },
        }).then((message) => {
          send("ai-chat-response", { requestId, text: String(message?.content || "") }, data.token);
        }).catch((error) => {
          send("ai-chat-error", {
            requestId,
            code: error?.isRateLimit ? "rate_limited" : (/session|sign in|App Check/i.test(error?.message || "") ? "unauthorized" : "upstream_error"),
            message: "AI request failed.",
          }, data.token);
        });
      }
      else if (data.type === "error") console.warn('[preview bridge]', data.payload?.message);
      else if (data.type === 'runtime_error' && onRuntimeErrorRef.current) onRuntimeErrorRef.current(data.payload);
      else if (
        (data.type === 'storage_set' || data.type === 'storage_remove' || data.type === 'storage_clear') &&
        onStorageChangeRef.current
      ) {
        onStorageChangeRef.current(data.type, data.payload);
      }
      else if (data.type === 'dom-snapshot' || data.type === 'screenshot-error') {
        const requestId = data.payload?.requestId;
        const pending = pendingCapturesRef.current.get(requestId);
        if (!pending) return;
        pendingCapturesRef.current.delete(requestId);
        clearTimeout(pending.timeoutId);
        if (data.type === 'screenshot-error') {
          pending.reject(new Error(data.payload?.message || 'Screenshot capture failed.'));
          return;
        }
        // The frame only clones markup + collects CSS text (see
        // previewBridge.js's module header for why); rasterizing that into a
        // canvas happens here, in this unsandboxed parent window.
        rasterizeDomSnapshot(data.payload)
          .then((dataUrl) => pending.resolve({ dataUrl }))
          .catch(pending.reject);
      }
    };

    const handleLoad = () => {
      push();
      forceRepaint();
      if (onReadyRef.current) onReadyRef.current({ token: previewToken });
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
  }, [previewSrcDoc, previewToken, previewMode, iframeRef, aiEnabled]);

  // Imperative request/response wrapper on top of the otherwise push-only
  // protocol -- see the pendingCapturesRef/onMessage handling above for the
  // response half.
  const requestScreenshot = useCallback((timeoutMs = 15000) => {
    return new Promise((resolve, reject) => {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) {
        reject(new Error('Preview is not ready.'));
        return;
      }
      const requestId = 'cap-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timeoutId = setTimeout(() => {
        pendingCapturesRef.current.delete(requestId);
        reject(new Error('Screenshot capture timed out.'));
      }, timeoutMs);
      pendingCapturesRef.current.set(requestId, { resolve, reject, timeoutId });
      sendRef.current('capture-screenshot', { requestId });
    });
  }, [iframeRef]);

  return { requestScreenshot };
}
