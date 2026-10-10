const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
  const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

// Host callbacks own React rendering and the sandbox bridge. The adapter never
// exports or persists test data, and only navigates within the project's files.
export function createEmbeddedBrowser({ mount, inspect, request, nativeInput, screenshot, navigate, reload, getToken, afterAction, signal }) {
  let files = {};
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
  const run = async (args) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let result = { success: true };
    if (args.action === 'navigate') {
      if (typeof args.text !== 'string' || !Object.hasOwn(files, args.text)) throw new Error('Navigate to an existing project filename.');
      navigate(args.text);
    } else if (args.action === 'reload') reload();
    else if (args.action === 'screenshot') result = await screenshot();
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
    return { ...result, observation };
  };
  return {
    async open(nextFiles) {
      files = nextFiles;
      mount(files);
      await pause(300, signal);
      return observe();
    },
    async execute(args) {
      try { return await run(args); } finally { afterAction?.(); }
    },
  };
}
