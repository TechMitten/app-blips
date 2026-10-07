// Run against Vite: MODEL_TEST_URL=http://127.0.0.1:5182 node testing/testProviderModelsUI.js
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
  let failure = false;
  await page.route(/\/models$/, async (route) => {
    await route.fulfill({ status: failure ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'test-coder', name: 'Test Coding Model' }] }) });
  });
  await page.goto(process.env.MODEL_TEST_URL || 'http://127.0.0.1:5182');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'API', exact: true }).click();
  const provider = page.locator('select:has(option[value="openrouter"])');
  for (const id of ['openrouter', 'openai', 'gemini', 'deepseek', 'lmstudio', 'ollama']) {
    await provider.selectOption(id);
    if (['openai', 'gemini', 'deepseek'].includes(id)) {
      await page.getByText('Enter your API key to load models, or enter a model ID manually.', { exact: true }).waitFor();
      await page.locator('input[type="password"]').fill('test-key');
    }
    await page.getByRole('button', { name: 'Refresh models', exact: true }).waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find((button) => button.textContent === 'Refresh models')?.disabled);
    await page.getByRole('combobox').filter({ hasNot: page.locator('option') }).click();
    await page.getByRole('option', { name: /Test Coding Model/ }).click();
    assert.equal(await page.locator('.model-combobox input').inputValue(), 'Test Coding Model');
  }
  failure = true;
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await page.getByText(/HTTP 503/).waitFor();
  await page.locator('.model-combobox input').fill('custom-coder');
  await page.locator('.model-combobox input').press('Enter');
  assert.equal(await page.locator('.model-combobox input').inputValue(), 'custom-coder');
  assert.deepEqual(errors, []);
  const onboarding = await browser.newPage();
  await onboarding.addInitScript(() => localStorage.setItem('orion-skip-splash', 'true'));
  await onboarding.route(/\/models$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'onboarding-coder', name: 'Onboarding Model' }] }) }));
  await onboarding.goto(process.env.MODEL_TEST_URL || 'http://127.0.0.1:5182');
  for (let step = 0; step < 2; step++) await onboarding.getByRole('button', { name: 'Next', exact: true }).click();
  await onboarding.locator('select').selectOption('gemini');
  await onboarding.locator('input[type="password"]').fill('test-key');
  await onboarding.locator('.model-combobox input').click();
  await onboarding.getByRole('option', { name: /Onboarding Model/ }).click();
  await onboarding.getByRole('button', { name: 'Start building', exact: true }).click();
  await onboarding.locator('.desktop-onboarding').waitFor({ state: 'detached' });
  const saved = await onboarding.evaluate(() => JSON.parse(localStorage.getItem('appblips-web-provider')));
  assert.equal(saved.id, 'gemini');
  assert.equal(saved.model, 'onboarding-coder');
  console.log('All six provider pickers, manual fallback, and onboarding selection passed.');
} finally { await browser.close(); }
