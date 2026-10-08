// Run with Vite running: node testing/testEmbeddedBrowser.mjs
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const url = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:5175';
const brokenHandler = 'function addTask(event) { event.preventDefault(); }';
const fixedHandler = "function addTask(event) { event.preventDefault(); tasks.push(document.getElementById('task').value); localStorage.setItem('tasks', JSON.stringify(tasks)); paint(); }";
const html = `<!DOCTYPE html><html><head><title>Tasks</title></head><body>
<h1>Tasks</h1><form id="task-form"><label for="task">Task</label><input id="task"><button>Add</button></form><ul id="tasks"></ul>
<script>
let tasks = JSON.parse(localStorage.getItem('tasks') || '[]');
function paint() { document.getElementById('tasks').replaceChildren(...tasks.map(text => { const item = document.createElement('li'); item.textContent = text; return item; })); }
${brokenHandler}
document.getElementById('task-form').addEventListener('submit', addTask); paint();
</script></body></html>`;
const project = { id: 'browser-test', name: 'Browser test', updatedAt: new Date().toISOString(), data: {
  studioMode: 'website', currentVersionIndex: 0,
  versions: [{ prompt: 'A task app', files: { 'index.html': html, 'about.html': '<!DOCTYPE html><html><body><h1>About this project</h1></body></html>' } }],
} };
const tool = (name, args) => ({ id: `call-${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const edit = (search, replace) => ({ tool_calls: [tool('apply_surgical_edits', { file: null, edits: [{ search, replace, occurrence: null, replace_all: null }] })] });
const accepted = () => ({ tool_calls: [tool('submit_code_review', { acceptable: true, findings: [] })] });
const browserAction = (action, extra = {}) => ({ tool_calls: [tool('browser_action', { action, target: null, text: null, key: null, x: null, y: null, ...extra })] });
const observed = (body) => {
  for (const message of [...body.messages].reverse()) {
    if (message.role === 'tool') {
      const result = JSON.parse(message.content);
      if (result.observation) return result.observation;
    }
    if (message.role === 'user' && typeof message.content === 'string' && message.content.startsWith('Current running browser page')) {
      return JSON.parse(message.content.split('): ')[1].split('\nUse browser_action')[0]);
    }
  }
  throw new Error('No browser observation in model request');
};
const element = (body, label) => {
  const el = observed(body).elements.find((item) => item.label === label);
  assert.ok(el, `Expected browser element ${label}`);
  return el.id;
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let reviewTurn = 0;
let coreTurn = 0;
const pageErrors = [];
try {
  await context.addInitScript((project) => {
    if (window !== window.top) return;
    if (localStorage.getItem('browser-test-seeded')) return;
    localStorage.setItem('browser-test-seeded', 'true');
    localStorage.setItem('appblips-web-provider', JSON.stringify({ onboardingComplete: true }));
    localStorage.setItem('orion-skip-splash', 'true');
    localStorage.setItem('orion-tour-seen', 'true');
    localStorage.setItem('orion-projects', JSON.stringify([project]));
    localStorage.setItem('orion-preview-storage:browser-test', JSON.stringify({ tasks: JSON.stringify(['Existing user task']) }));
  }, project);
  await context.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON();
    let message;
    if (body.tools?.some((item) => item.function.name === 'browser_action')) {
      switch (reviewTurn++) {
        case 0: message = accepted(); break; // Must be rejected until testing occurs.
        case 1: message = browserAction('inspect'); break;
        case 2: message = browserAction('type', { target: element(body, 'Task'), text: 'Disposable review task' }); break;
        case 3: message = browserAction('click', { target: element(body, 'Add task') }); break;
        case 4:
          assert.equal(observed(body).text.includes('Disposable review task'), false, 'broken behavior is actually observed');
          message = edit(brokenHandler, fixedHandler); break;
        case 5:
          assert.equal(observed(body).text.includes('Existing user task'), false, 'review runs with separate temporary storage');
          message = browserAction('type', { target: element(body, 'Task'), text: 'Disposable review task' }); break;
        case 6: message = browserAction('click', { target: element(body, 'Add task') }); break;
        case 7:
          assert.ok(observed(body).text.includes('Disposable review task'), 'improvement works in the running browser');
          message = browserAction('reload'); break;
        case 8:
          assert.ok(observed(body).text.includes('Disposable review task'), 'temporary storage survives reviewer reload');
          message = browserAction('navigate', { text: 'about.html' }); break;
        case 9:
          assert.match(observed(body).text, /About this project/);
          message = accepted(); break;
        default: throw new Error('Unexpected review request');
      }
    } else if (body.tools) {
      message = coreTurn++ === 0 ? edit('<button>Add</button>', '<button>Add task</button>') : { content: 'Updated the button.' };
    } else if (body.messages[0].content.includes('past tense')) message = { content: 'Updated and checked the task app.' };
    else message = { content: 'I will update your task app.' };
    if (body.stream) {
      const delta = { ...message, tool_calls: message.tool_calls?.map((call, index) => ({ ...call, index })) };
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n` });
    } else await route.fulfill({ json: { choices: [{ message }] } });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name: 'My projects', exact: true }).click();
  await page.getByRole('button', { name: /^Browser test/ }).click();
  await expect(page.getByRole('button', { name: 'Browser', exact: true }).last()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Project page address' })).toHaveValue('appblips.local/index.html');
  await page.getByRole('textbox', { name: 'Project page address' }).fill('appblips.local/about.html');
  await page.getByRole('textbox', { name: 'Project page address' }).press('Enter');
  await expect(page.frameLocator('iframe[data-appblips-browser]').getByRole('heading', { name: 'About this project' })).toBeVisible();
  await page.getByRole('button', { name: 'Browser back', exact: true }).click();
  await expect(page.frameLocator('iframe[data-appblips-browser]').getByText('Existing user task')).toBeVisible();
  await page.locator('#prompt').fill('Make the add task feature work');
  await page.getByRole('button', { name: 'Update Website', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop browser testing' })).toBeVisible();
  await expect(page.locator('.building-overlay')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/appblips-browser-testing.png' });
  await expect(page.getByRole('button', { name: 'Stop browser testing' })).toHaveCount(0, { timeout: 30000 });
  await expect(page.frameLocator('iframe[data-appblips-browser]').getByText('Existing user task')).toBeVisible();
  assert.equal(reviewTurn, 10);
  const saved = await page.evaluate(() => ({
    projects: JSON.parse(localStorage.getItem('orion-projects')),
    storage: JSON.parse(localStorage.getItem('orion-preview-storage:browser-test')),
  }));
  assert.deepEqual(JSON.parse(saved.storage.tasks), ['Existing user task'], 'review must not save disposable test data');
  const latest = saved.projects.find((item) => item.id === project.id).data.versions.at(-1);
  assert.equal(latest.qualityReview.acceptable, true);
  assert.ok(latest.qualityReview.browserTests.some((item) => item.action === 'reload'));
  assert.ok(latest.files['index.html'].includes(fixedHandler));
  assert.ok(!latest.files['index.html'].includes('data-orion-browser-cursor'), 'browser tooling is never saved into code');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Workspace view' }).getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Project page address' })).toBeVisible();
  const bar = await page.locator('.embedded-browser-bar').boundingBox();
  assert.ok(bar.width <= 390, 'browser navigation fits on phones');
  await page.getByRole('textbox', { name: 'Project page address' }).fill('https://example.com');
  await page.getByRole('textbox', { name: 'Project page address' }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('Enter a page from this project.');
  assert.deepEqual(pageErrors, []);
  console.log('testEmbeddedBrowser: ok (navigation, interaction failure, improvement, retest, reload, and data isolation)');
} finally { await browser.close(); }
