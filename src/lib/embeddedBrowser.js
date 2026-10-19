const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
  const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

const VIEWPORTS = ['mobile', 'tablet', 'desktop'];
const VIEWPORT_SETTLE_MS = 600;
// A screenshot covers the whole page from the top, one image per screen.
// Left to scroll and switch sizes by itself the reviewer usually stopped
// after the first screen of one size. The cap bounds the images per size.
export const MAX_SCREENS_PER_SIZE = 8;
// Screens overlap a little so a line cut at one edge is whole in the next.
const SCREEN_OVERLAP_PX = 40;
// Actions that can change what a page looks like. Until one runs, a page
// already captured at a screen size would only produce the same images again.
const CHANGING_ACTIONS = ['click', 'type', 'press', 'reload'];

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
  // Screenshots each screen of the current size from the top to the end of
  // the page, then scrolls back so later actions see the page as it was.
  const captureScreens = async () => {
    let view = (await observe()).viewport || lastViewport;
    const start = view?.scrollY || 0;
    const shots = [];
    let moved = 0;
    try {
      if (start) {
        moved = await scrollBy(-start);
        await pause(250, signal);
        view = (await observe()).viewport;
      }
      for (;;) {
        const shot = await screenshot({ viewportWidth: view?.width });
        const previous = shots.at(-1);
        // The last screen stops at the page's end, so most of it can repeat
        // the one before; the label says how much.
        const repeatsPx = previous && view ? Math.round(previous.scrollY + previous.visibleHeight - view.scrollY) : 0;
        shots.push({
          dataUrl: shot.dataUrl, screen: currentScreen, width: view?.width, height: view?.height,
          scrollY: view?.scrollY ?? null, visibleHeight: view?.visibleHeight || view?.height, pageHeight: view?.pageHeight,
          ...(repeatsPx > SCREEN_OVERLAP_PX + 1 ? { repeatsPx } : {}),
        });
        if (!view || view.atBottom !== false) break;
        if (shots.length >= MAX_SCREENS_PER_SIZE) {
          shots.at(-1).pageContinues = true;
          break;
        }
        const step = Math.max(100, Math.round((view.visibleHeight || view.height) - SCREEN_OVERLAP_PX));
        const scrolled = await scrollBy(step);
        if (!scrolled) break;
        moved += scrolled;
        // Lets lazy images and scroll-triggered effects settle.
        await pause(250, signal);
        view = (await observe()).viewport;
      }
    } finally {
      if (moved) await scrollBy(-moved);
    }
    return shots;
  };
  // Page and screen sizes captured since the page last changed, and pages
  // screenshotted at all.
  const captured = new Set();
  const seenPages = new Set();
  const capturedKey = (size) => `${getPage?.() || ''}|${size}`;
  const switchScreen = async (size) => {
    if (size === currentScreen) return;
    setViewport(size);
    currentScreen = size;
    // The device frame animates to its new size; observing mid-animation
    // would report an in-between width.
    await pause(VIEWPORT_SETTLE_MS, signal);
  };
  // The first screenshot of a page covers every screen size; later ones, the
  // current size. Sizes already captured since the page last changed are
  // skipped instead of sending the same images again.
  const screenshotPage = async () => {
    const firstLook = !seenPages.has(getPage?.() || '');
    const sizes = (firstLook || !currentScreen ? VIEWPORTS : [currentScreen]).filter((size) => !captured.has(capturedKey(size)));
    if (!sizes.length) {
      return { shots: [], alreadyCaptured: 'Nothing has changed since this page was screenshotted at this screen size, so no new images were taken: use your notes from then. Interact with the page or go to another page first.' };
    }
    const original = currentScreen;
    seenPages.add(getPage?.() || '');
    const shots = [];
    try {
      for (const size of sizes) {
        await switchScreen(size);
        shots.push(...await captureScreens());
        captured.add(capturedKey(size));
      }
    } finally {
      if (original) await switchScreen(original);
    }
    return { shots };
  };
  const run = async (args) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let result = { success: true };
    if (CHANGING_ACTIONS.includes(args.action)) captured.clear();
    if (args.action === 'navigate') {
      if (typeof args.text !== 'string' || !Object.hasOwn(files, args.text)) throw new Error('Navigate to an existing project filename.');
      navigate(args.text);
    } else if (args.action === 'reload') reload();
    else if (args.action === 'viewport') {
      if (!VIEWPORTS.includes(args.text)) throw new Error('Viewport must be mobile, tablet or desktop.');
      await switchScreen(args.text);
    }
    else if (args.action === 'screenshot') {
      result = { ...(await screenshotPage()), page: getPage?.() || null, screen: currentScreen };
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
    // The review's own first look: every screen size of the landing page,
    // taken before the reviewer's first turn.
    async capturePage() {
      try { return await run({ action: 'screenshot' }); } finally { afterAction?.(); }
    },
    async execute(args) {
      try { return await run(args); } finally { afterAction?.(); }
    },
  };
}
