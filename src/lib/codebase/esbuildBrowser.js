// Lazily starts esbuild-wasm in the renderer, the first time an imported
// codebase needs building. Its ~11 MB wasm ships with the app (served from
// appblips://app like any other asset, never fetched from the network) and is
// loaded through a dynamic import, so the rest of AppBlips never pays for it.
let ready = null;

export function loadEsbuild() {
  if (!ready) {
    ready = (async () => {
      const [esbuild, { default: wasmURL }] = await Promise.all([
        import('esbuild-wasm'),
        import('esbuild-wasm/esbuild.wasm?url'),
      ]);
      // A worker keeps builds off the UI thread.
      await esbuild.initialize({ wasmURL, worker: true });
      return esbuild;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}
