// Headless-browser test for voice input on the hero: Chromium's fake
// microphone plays a speech clip, the mic button records it, and the bundled
// Whisper model (src/lib/whisperWorker.js) must transcribe it into the prompt
// without any request leaving the app's own server.
//
//   npx playwright install chromium   # once
//   npm run build
//   node testing/testVoiceInput.mjs
//
// Starts server.js on a spare port to serve dist/. The clip is President
// Kennedy's 1961 inaugural line (public domain), 16 kHz mono.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const clip = fileURLToPath(new URL('./fixtures/voice-jfk.wav', import.meta.url));
const port = 3000 + Math.floor(Math.random() * 1000) + 1000;
const origin = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.on('exit', (code) => reject(new Error(`server.js exited with ${code}`)));
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes(String(port))) resolve();
  });
});

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${clip}`,
  ],
});

try {
  const context = await browser.newContext({ permissions: ['microphone'] });
  await context.addInitScript(() => {
    localStorage.setItem('appblips-web-provider', JSON.stringify({ onboardingComplete: true }));
    localStorage.setItem('orion-splash-last-shown', String(Date.now()));
  });
  const offsite = [];
  context.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) offsite.push(url);
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  await page.goto(origin);
  const skip = page.getByRole('button', { name: 'Skip video' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole('button', { name: /Mobile & Web App/ }).click();

  const mic = page.getByRole('button', { name: 'Start voice input' });
  await expect(mic).toBeVisible();
  await mic.click();
  await expect(page.getByText('Listening…')).toBeVisible();
  // The clip is 11 s; the fake device loops it, so record all of it once.
  await page.waitForTimeout(11500);
  await page.getByRole('button', { name: 'Stop voice input' }).click();
  await expect(page.getByText('Transcribing…')).toBeVisible();
  await expect(page.locator('#prompt')).toHaveValue(/what your country can do for you/i, { timeout: 120_000 });
  await expect(page.getByText('Transcribing…')).toHaveCount(0);

  console.log('Transcript:', await page.locator('#prompt').inputValue());
  // The UI's own fonts etc. may come from elsewhere; voice input must not.
  const voiceOffsite = offsite.filter((url) => /huggingface|jsdelivr|onnx|whisper|\.wasm/i.test(url));
  assert.deepEqual(voiceOffsite, [], 'Voice input fetched nothing from outside the app');
  assert.deepEqual(consoleErrors.filter((text) => /whisper|onnx|voice/i.test(text)), [], 'No voice-input errors in the console');
  console.log('ok testVoiceInput');
} finally {
  await browser.close();
  server.kill();
}
