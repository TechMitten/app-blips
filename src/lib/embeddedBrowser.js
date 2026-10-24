const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
  const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

const VIEWPORTS = ['mobile', 'tablet', 'desktop'];
const VIEWPORT_SETTLE_MS = 600;
// A screenshot is taken only when the reviewer wants to show or confirm a
// specific problem, so it is one image of the current screen size, scrolled
// to the element in question. Whole-page captures at every size used to send
// dozens of images per review for pages that tested fine.

// Host callbacks own React rendering and the sandbox bridge. The adapter never
// exports or persists test data, and only navigates within the project's files.
export function createEmbeddedBrowser({ mount, inspect, request, nativeInput, screenshot, navigate, reload, setViewport, getToken, getPage, screen = null, afterAction, signal }) {
  let files = {};
  // For labelling screenshots, and the page's own width so a zoomed-out
  // preview can still be captured at full size.
  let currentScreen = VIEWPORTS.includes(screen) ? screen : null;
  let lastViewport = null;
  const observe = async () => {
    let lastError;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const observation = await inspect(600);
        if (observation.readyState !== 'loading') return observation;
        lastError = new Error('Browser page is still loading.');
      } catch (error) { lastError = error; }
      await pause(100, signal);
    }
    throw lastError || new Error('Embedded browser did not become ready.');
  };
  // Scrolls by any amount in steps the runtime accepts; returns how far it went.
  const scrollBy = async (amount) => {
    let moved = 0;
    while (moved !== amount && !signal?.aborted) {
      const { scrolledBy = 0 } = await request({ action: 'scroll', y: Math.max(-5000, Math.min(5000, amount - moved)) });
      if (!scrolledBy) break;
      moved += scrolledBy;
    }
    return moved;
  };
  const switchScreen = async (size) => {
    if (size === currentScreen) return;
    setViewport(size);
    currentScreen = size;
    // The device frame animates to its new size; observing mid-animation
    // would report an in-between width.
    await pause(VIEWPORT_SETTLE_MS, signal);
  };
  // One image of what is on screen, with `target` scrolled into view first,
  // then scrolled back so later actions see the page as it was.
  const screenshotView = async (target) => {
    const start = (await observe()).viewport?.scrollY || 0;
    if (target) {
      // Scrolls the element to the middle of the screen. It still counts as
      // shown when it is covered or disabled: that can be the very problem.
      try { await request({ action: 'target', target }); } catch (error) {
        if (/no longer available/.test(error?.message || '')) throw error;
      }
      await pause(250, signal);
    }
    const view = (await observe()).viewport || lastViewport;
    try {
      const shot = await screenshot({ viewportWidth: view?.width });
      return [{
        dataUrl: shot.dataUrl, screen: currentScreen, width: view?.width, height: view?.height,
        scrollY: view?.scrollY ?? null, pageHeight: view?.pageHeight,
      }];
    } finally {
      const moved = (view?.scrollY || 0) - start;
      if (target && moved) await scrollBy(-moved);
    }
  };
  const run = async (args) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let result = { success: true };
    if (args.action === 'navigate') {
      if (typeof args.text !== 'string' || !Object.hasOwn(files, args.text)) throw new Error('Navigate to an existing project filename.');
      navigate(args.text);
    } else if (args.action === 'reload') reload();
    else if (args.action === 'viewport') {
      if (!VIEWPORTS.includes(args.text)) throw new Error('Viewport must be mobile, tablet or desktop.');
      await switchScreen(args.text);
    }
    else if (args.action === 'screenshot') {
      result = { shots: await screenshotView(args.target), page: getPage?.() || null, screen: currentScreen };
    }
    else if (['click', 'type', 'press'].includes(args.action)) {
      if (args.action === 'type' && (typeof args.text !== 'string' || args.text.length > 2000)) throw new Error('Text must be at most 2000 characters.');
      if (nativeInput) {
        const point = await request(args.target ? { action: 'target', target: args.target, focus: args.action !== 'click', select: args.action === 'type' } : { action: 'point', x: args.x, y: args.y });
        if (args.action === 'type' && !point.acceptsText) throw new Error('Choose a text field.');
        result = await nativeInput({ action: args.action, token: getToken(), x: point.x / point.width, y: point.y / point.height, text: args.text, key: args.key });
      } else result = await request(args);
    } else if (args.action === 'scroll') result = await request(args);
    else if (args.action !== 'inspect') throw new Error('Unsupported browser action.');
    await pause(250, signal);
    const observation = await observe();
    lastViewport = observation.viewport || lastViewport;
    return { ...result, observation };
  };
  return {
    async open(nextFiles) {
      files = nextFiles;
      mount(files);
      await pause(300, signal);
      const observation = await observe();
      lastViewport = observation.viewport || null;
      return observation;
    },
    async execute(args) {
      try { return await run(args); } finally { afterAction?.(); }
    },
  };
}
