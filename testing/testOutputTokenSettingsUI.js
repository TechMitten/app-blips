// Run against Vite: TOKEN_TEST_URL=http://127.0.0.1:5183 node testing/testOutputTokenSettingsUI.js
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('orion-skip-splash', 'true');
    localStorage.setItem('appblips-web-provider', JSON.stringify({ enabled: false, onboardingComplete: true }));
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests = [];
  await page.route('**/api/chat', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) });
  });
  await page.goto(process.env.TOKEN_TEST_URL || 'http://127.0.0.1:5183');
  const openAISettings = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
  };
  const request = async (options = {}) => {
    await page.evaluate(async (options) => {
      const { requestModelText } = await import('/src/lib/llm.js');
      await requestModelText({ messages: [{ role: 'user', content: 'hi' }], retry: false, ...options });
    }, options);
    return requests.at(-1);
  };
  await openAISettings();
  const build = page.getByRole('spinbutton', { name: 'Output tokens: building', exact: true });
  const ask = page.getByRole('spinbutton', { name: 'Output tokens: Ask', exact: true });
  assert.equal(await build.inputValue(), '');
  assert.equal(await ask.inputValue(), '');
  assert.equal((await request()).max_tokens, undefined);
  assert.equal((await request({ askMode: true })).max_tokens, undefined);

  await build.fill('24000');
  await ask.fill('12000');
  assert.equal((await request()).max_tokens, 24000);
  assert.equal((await request({ forceTemperatureZero: true })).max_tokens, 24000);
  assert.equal((await request({ askMode: true })).max_tokens, 12000);

  await build.fill('0');
  assert.equal(await build.getAttribute('aria-invalid'), 'true');
  await page.getByRole('alert').filter({ hasText: 'Not saved.' }).waitFor();
  assert.equal((await request()).max_tokens, 24000);
  await build.fill('1.5');
  assert.equal(await build.getAttribute('aria-invalid'), 'true');
  assert.equal((await request()).max_tokens, 24000);
  await build.fill('24000');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await openAISettings();
  assert.equal(await build.inputValue(), '24000');
  assert.equal(await ask.inputValue(), '12000');
  assert.equal((await request()).max_tokens, 24000);

  await page.getByRole('button', { name: 'Use default for building', exact: true }).click();
  assert.equal(await build.inputValue(), '');
  assert.equal((await request()).max_tokens, undefined);
  assert.equal((await request({ askMode: true })).max_tokens, 12000);
  await ask.fill('');
  assert.equal((await request({ askMode: true })).max_tokens, undefined);
  await page.reload();
  await openAISettings();
  assert.equal(await build.inputValue(), '');
  assert.equal(await ask.inputValue(), '');
  assert.deepEqual(errors, []);
  console.log('Output limits: provider defaults, saved custom limits, request routing, validation, persistence, and reset passed.');
} finally {
  await browser.close();
}
