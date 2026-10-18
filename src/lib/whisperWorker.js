// Voice input's speech-to-text: Whisper (base, multilingual) running in this
// worker through transformers.js and ONNX Runtime's WebAssembly backend, so
// the recording is transcribed on this computer and never uploaded. The model
// is bundled under /whisper/ (scripts/fetch-whisper-model.js) and remote
// loading is switched off, so a missing file fails instead of quietly fetching
// from Hugging Face. A worker keeps the UI responsive while the model loads
// and runs.
import { env, pipeline } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('/whisper/models/', self.location.href).href;
// The files are already local; caching them would only store a second copy.
env.useBrowserCache = false;
// transformers.js points ONNX Runtime at a CDN copy of its .wasm. Without
// that, ONNX Runtime loads the copy Vite already emits into assets/.
delete env.backends.onnx.wasm.wasmPaths;
// The app isn't cross-origin isolated, so there's no SharedArrayBuffer for
// threads; asking for one thread skips ONNX Runtime's failed attempt.
env.backends.onnx.wasm.numThreads = 1;

let transcriberPromise = null;

function loadTranscriber() {
  transcriberPromise ??= pipeline('automatic-speech-recognition', 'whisper-base', {
    dtype: 'q8',
    device: 'wasm',
  }).catch((err) => {
    // Let the next request try again rather than caching the failure.
    transcriberPromise = null;
    throw err;
  });
  return transcriberPromise;
}

async function transcribe(audio, language) {
  const transcriber = await loadTranscriber();
  // Whisper handles audio longer than its 30 s window in overlapping chunks.
  const options = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
  try {
    return await transcriber(audio, language ? { ...options, language } : options);
  } catch (err) {
    // A UI language Whisper doesn't know: let it detect the language itself.
    if (language && /is not supported/.test(String(err?.message))) return transcriber(audio, options);
    throw err;
  }
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      await loadTranscriber();
      self.postMessage({ id, type: 'ready' });
    } else if (type === 'transcribe') {
      const result = await transcribe(data.audio, data.language);
      const text = (Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text) || '';
      self.postMessage({ id, type: 'result', text: text.trim() });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err?.message || err) });
  }
};
