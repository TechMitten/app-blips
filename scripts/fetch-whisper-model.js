// Puts the Whisper model voice input uses into public/whisper/ (gitignored), so
// Vite copies it into dist/ and every host (desktop app, npm start, Docker)
// ships it: the model is bundled, never downloaded by the running app.
// Runs from the Vite config on every dev/build start (whisperAssetsPlugin) and
// does nothing when the files are already there; `node scripts/fetch-whisper-model.js`
// runs it on its own.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WHISPER_DIR = join(ROOT, 'public', 'whisper');

// Pinned to one revision and checked by hash, so a changed or tampered upload
// on Hugging Face fails the build instead of shipping. The q8 ("quantized")
// encoder and merged decoder are what transformers.js loads for dtype 'q8'.
const MODEL_REPO = 'onnx-community/whisper-base';
const MODEL_REVISION = '1846881b6b3a3024392c1eea3ad983695bc23925';
const MODEL_FILES = {
  'config.json': 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b',
  'generation_config.json': '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0',
  'preprocessor_config.json': 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
  'tokenizer.json': '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
  'tokenizer_config.json': '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573',
  'onnx/encoder_model_quantized.onnx': '5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46',
  'onnx/decoder_model_merged_quantized.onnx': 'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b',
};
const MODEL_DIR = join(WHISPER_DIR, 'models', 'whisper-base');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function readOrNull(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function ensureModelFile(name, hash) {
  const target = join(MODEL_DIR, name);
  const existing = await readOrNull(target);
  if (existing && sha256(existing) === hash) return false;

  const url = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== hash) throw new Error(`${name} from ${url} does not match its pinned sha256`);
  await mkdir(dirname(target), { recursive: true });
  // Written under a temporary name first, so an interrupted run never leaves a
  // truncated model that a later run would have to notice.
  await writeFile(`${target}.part`, data);
  await rename(`${target}.part`, target);
  return true;
}

export async function ensureWhisperAssets({ log = console.log } = {}) {
  const missing = [];
  for (const [name, hash] of Object.entries(MODEL_FILES)) {
    const existing = await readOrNull(join(MODEL_DIR, name));
    if (!existing || sha256(existing) !== hash) missing.push(name);
  }
  if (missing.length === 0) return;
  log(`Downloading the Whisper voice model (${MODEL_REPO}, about 80 MB, once)…`);
  for (const name of missing) {
    await rm(join(MODEL_DIR, `${name}.part`), { force: true });
    await ensureModelFile(name, MODEL_FILES[name]);
    log(`  ${name}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await ensureWhisperAssets();
  console.log(`Whisper files ready in ${WHISPER_DIR}`);
}
