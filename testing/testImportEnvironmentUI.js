// Run against Vite: IMPORT_TEST_URL=http://127.0.0.1:5184 node testing/testImportEnvironmentUI.js
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { zipSync } from 'fflate';

const source = 'document.getElementById("root").textContent = import.meta.env.VITE_TITLE;';
const standalone = source.replace('import.meta.env.VITE_TITLE', '"Standalone site"');
const files = {
  'package.json': JSON.stringify({ name: 'env-test-site', dependencies: { react: '^19', 'react-dom': '^19', vite: '^8' } }),
  'index.html': '<html><head><title>%VITE_TITLE%</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
  'src/main.jsx': source,
  '.env.example': 'VITE_TITLE=',
  '.env': 'PRIVATE_KEY=zip-secret-never-sent',
};
const zip = (fileMap) => ({ name: 'site.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(Object.fromEntries(Object.entries(fileMap).map(([path, text]) => [path, new TextEncoder().encode(text)])))) });
const browser = await chromium.launch({ headless: true });
const errors = [];
const newPage = async () => {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('orion-skip-splash', 'true');
    localStorage.setItem('orion-reasoning-effort-build', 'high');
    localStorage.setItem('appblips-web-provider', JSON.stringify({ enabled: false, onboardingComplete: true }));
  });
  await page.goto(process.env.IMPORT_TEST_URL || 'http://127.0.0.1:5184');
  await page.getByRole('button', { name: /Import a site/ }).first().click();
  return page;
};
const upload = async (page, fileMap = files) => page.locator('input[type=file][accept*=zip]').setInputFiles(zip(fileMap));
const savedProject = async (page) => {
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('orion-projects') || '[]').length === 1);
  return page.evaluate(() => JSON.parse(localStorage.getItem('orion-projects'))[0]);
};

try {
  const manual = await newPage();
  await upload(manual);
  const dialog = manual.getByRole('dialog', { name: 'Import a site', exact: true });
  await dialog.getByText('This site needs a few settings').waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Open site', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: /I’ll fill in the .env settings/ }).click();
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Add a value for VITE_TITLE' }).waitFor();
  await dialog.getByLabel('Public .env settings', { exact: true }).fill('VITE_TITLE="My public site title"');
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Open site', exact: true }).click();
  const manualRow = await savedProject(manual);
  assert.equal(manualRow.data.codebase.environmentResolution, 'manual');
  assert.ok(manualRow.data.versions[0].tree['.env.local']);
  await manual.reload();
  assert.equal((await savedProject(manual)).data.versions[0].tree['.env.local'], manualRow.data.versions[0].tree['.env.local']);
  await manual.close();

  const ai = await newPage();
  let mode = 'fail';
  let toolsTurn = 0;
  const requests = [];
  let startedSlowRequest;
  const slowRequestStarted = new Promise((resolve) => { startedSlowRequest = resolve; });
  await ai.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (mode === 'fail') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Test provider unavailable. Try again.' }) });
    if (mode === 'slow') {
      startedSlowRequest();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' }).catch(() => {});
      return;
    }
    let delta = { content: 'Your standalone site is ready.' };
    if (body.tools) {
      assert.equal(body.reasoning_effort, 'high', 'import honors the saved reasoning setting');
      assert.ok(body.messages.filter((message) => message.role === 'assistant').every((message) => message.reasoning_content === 'test-reasoning'));
      const turn = toolsTurn++;
      if (turn < 3) delta = { tool_calls: [{ index: 0, id: `review_${turn}`, type: 'function', function: {
        name: 'read_file', arguments: JSON.stringify({ path: 'src/main.jsx', start_line: null, end_line: null }),
      } }] };
      else if (turn === 3) {
        assert.equal(body.tool_choice, 'required');
        assert.ok(body.tools.every((tool) => !['read_file', 'list_files', 'search_files'].includes(tool.function.name)));
        delta = { tool_calls: [{ index: 0, id: 'remove_env', type: 'function', function: {
          name: 'apply_file_changes', arguments: JSON.stringify({ changes: [
            { action: 'edit', path: 'src/main.jsx', edits: [{ search: source, replace: standalone }], content: null },
            { action: 'edit', path: 'index.html', edits: [{ search: '%VITE_TITLE%', replace: 'Standalone site' }], content: null },
            { action: 'delete', path: '.env.example', edits: null, content: null },
          ] }),
        } }] };
      }
    }
    const deltas = body.tools ? [{ reasoning_content: 'test-reasoning' }, delta] : [delta];
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: deltas.map((item) => `data: ${JSON.stringify({ choices: [{ delta: item }] })}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await upload(ai);
  await ai.getByRole('button', { name: /Use AI to remove the .env dependency/ }).click();
  await ai.getByRole('alert').waitFor({ timeout: 30000 });
  assert.equal(await ai.getByRole('button', { name: /I’ll fill in the .env settings/ }).count(), 1, 'failure returns to the choices');
  assert.equal(await ai.evaluate(() => localStorage.getItem('orion-projects')), null, 'failed preparation does not save a partial project');
  mode = 'slow';
  await ai.getByRole('button', { name: /Use AI to remove the .env dependency/ }).click();
  await slowRequestStarted;
  await ai.getByRole('button', { name: 'Stop', exact: true }).click();
  await ai.waitForTimeout(1500);
  assert.equal(await ai.getByRole('button', { name: /I’ll fill in the .env settings/ }).count(), 1, 'cancelled request cannot advance the import');
  assert.equal(await ai.evaluate(() => localStorage.getItem('orion-projects')), null);
  mode = 'success';
  await ai.getByRole('button', { name: /Use AI to remove the .env dependency/ }).click();
  await ai.getByRole('button', { name: 'Open site', exact: true }).click({ timeout: 60000 });
  const aiRow = await savedProject(ai);
  assert.equal(aiRow.data.codebase.environmentResolution, 'ai');
  assert.equal(aiRow.data.versions.length, 2);
  assert.equal(aiRow.data.currentVersionIndex, 1);
  assert.notEqual(aiRow.data.versions[0].tree['src/main.jsx'], aiRow.data.versions[1].tree['src/main.jsx'], 'original available for undo');
  assert.ok(!JSON.stringify(requests).includes('zip-secret-never-sent'));
  await ai.close();

  const independent = await newPage();
  let independentAiRequests = 0;
  await independent.route('**/api/chat', async (route) => {
    independentAiRequests++;
    await route.fulfill({ status: 400, body: '{}' });
  });
  await upload(independent, { ...files, 'src/main.jsx': standalone, 'index.html': files['index.html'].replace('%VITE_TITLE%', 'Independent site') });
  await independent.getByRole('button', { name: /Use AI to remove the .env dependency/ }).click();
  await independent.getByText('This site already starts without .env settings.', { exact: false }).waitFor();
  await independent.getByRole('button', { name: 'Open site', exact: true }).click();
  const independentRow = await savedProject(independent);
  assert.equal(independentRow.data.codebase.environmentResolution, 'verified');
  assert.equal(independentRow.data.versions.length, 1);
  assert.equal(independentAiRequests, 0);
  await independent.close();

  // Reproduce a generator-only "fix": it compiles, but the blog JSON that
  // the live page fetches is still absent. Repair it before showing Open site.
  const blog = await newPage();
  const blogSource = `const endpoint = import.meta.env.VITE_API_URL;
fetch(endpoint + '/blog/index.json').then((response) => {
  if (!response.ok) throw new Error('Blog content is unavailable. Run the build to generate the static blog data.');
  return response.json();
}).then((posts) => { document.getElementById('root').textContent = posts[0]?.title || 'No blog posts'; })
  .catch((error) => console.error('Failed to fetch blog posts for home page:', error));`;
  let blogTurn = 0;
  let sawRuntimeFeedback = false;
  const blogRequests = [];
  await blog.route('**/blog/index.json', (route) => route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await blog.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON();
    blogRequests.push(body);
    let delta = { content: 'Your standalone blog is ready.' };
    if (body.tools) {
      const turn = blogTurn++;
      let changes;
      if (turn === 0) changes = [
        { action: 'edit', path: 'src/main.jsx', content: null, edits: [{ search: 'import.meta.env.VITE_API_URL', replace: JSON.stringify(new URL(process.env.IMPORT_TEST_URL || 'http://127.0.0.1:5184').origin) }] },
        { action: 'edit', path: 'index.html', content: null, edits: [{ search: '%VITE_TITLE%', replace: 'Local blog' }] },
      ];
      if (turn === 1) {
        sawRuntimeFeedback = body.messages.some((message) => message.role === 'user' && message.content?.includes('Preview startup error') && message.content.includes('Blog content is unavailable'));
        assert.ok(sawRuntimeFeedback, 'a passing bundle must still report missing startup data to the AI');
        assert.equal(await blog.getByRole('button', { name: 'Open site', exact: true }).count(), 0);
        changes = [
          { action: 'create', path: 'public/blog/index.json', content: '[{"title":"Local blog post"}]', edits: null },
          { action: 'edit', path: 'src/main.jsx', content: null, edits: [{ search: "fetch(endpoint + '/blog/index.json')", replace: "fetch('/blog/index.json')" }] },
        ];
      }
      if (changes) delta = { tool_calls: [{ index: 0, id: `blog_${turn}`, type: 'function', function: { name: 'apply_file_changes', arguments: JSON.stringify({ changes }) } }] };
    }
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n` });
  });
  await upload(blog, { ...files, 'src/main.jsx': blogSource, '.env.example': 'VITE_API_URL=\nVITE_TITLE=' });
  await blog.getByRole('button', { name: /Use AI to remove the .env dependency/ }).click();
  await blog.getByRole('button', { name: 'Open site', exact: true }).click({ timeout: 60000 });
  const blogRow = await savedProject(blog);
  assert.ok(blogRow.data.versions[1].tree['public/blog/index.json']);
  assert.ok(sawRuntimeFeedback);
  await blog.frameLocator('iframe').first().getByText('Local blog post', { exact: true }).waitFor();
  await blog.waitForTimeout(1000);
  assert.equal(blogRequests.filter((request) => request.tools).length, 3, 'opening the repaired project does not launch another automatic repair');
  assert.equal(await blog.locator('iframe[aria-hidden=true]').count(), 0, 'test frames are cleaned up');
  await blog.close();

  const probe = await newPage();
  await probe.route('**/slow-blog-data', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  });
  const probeResults = await probe.evaluate(async () => {
    const { checkCodebaseRuntime } = await import('/src/lib/codebase/runtimeCheck.js');
    const base = {
      files: { 'package.json': '{}', 'index.html': '<html><head></head><body><div id="root"></div><script type="module" src="/src/main.js"></script></body></html>' },
      assets: {}, meta: { entry: 'src/main.js' }, settleMs: 100, timeoutMs: 3000,
    };
    const run = (code, extra = {}) => checkCodebaseRuntime({ ...base, ...extra, files: { ...base.files, 'src/main.js': code } });
    const delayedUrl = new URL('/slow-blog-data', window.location.href).href;
    const delayed = await run(`fetch(${JSON.stringify(delayedUrl)}).then(() => { throw new Error('Delayed blog startup failure'); }).catch((error) => console.error(error));`);
    const storage = await run(`localStorage.setItem('probe-storage','test-only'); document.getElementById('root').textContent='Ready';`);
    const timeout = await run('await new Promise(() => {});', { timeoutMs: 200 });
    const controller = new AbortController();
    const cancelled = run('await new Promise(() => {});', { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    let abortName;
    try { await cancelled; } catch (error) { abortName = error.name; }

    // Exercise HTML parsing of the actual tracker with a hostile token. Only
    // the runtime token is overridden; the bridge still gets a normal UUID.
    const hostileToken = `"\\\n</ScRiPt><script>parent.postMessage({__appblipsInjection:true},'*')</script><!--\u2028\u2029`;
    const originalUUID = crypto.randomUUID;
    let tokenUsed = false;
    crypto.randomUUID = () => {
      if (tokenUsed) return originalUUID.call(crypto);
      tokenUsed = true;
      return hostileToken;
    };
    let injected = false;
    const fetchCounts = [];
    const observe = (event) => {
      if (event.data?.__appblipsInjection) injected = true;
      if (event.data?.__appblipsRuntime === hostileToken && event.data.type === 'fetch-pending') fetchCounts.push(event.data.count);
    };
    window.addEventListener('message', observe);
    let hostile;
    try {
      hostile = await run(`fetch('data:application/json,{}').then((response) => response.json());`);
    } finally {
      crypto.randomUUID = originalUUID;
      window.removeEventListener('message', observe);
    }
    return { delayed, storage, timeout, abortName, hostile, injected, fetchCounts, savedStorage: localStorage.getItem('probe-storage'), remainingFrames: document.querySelectorAll('iframe[aria-hidden=true]').length };
  });
  assert.ok(probeResults.delayed.errors[0].message.includes('Delayed blog startup failure'), 'await pending startup requests beyond the quiet interval');
  assert.deepEqual(probeResults.storage.errors, []);
  assert.equal(probeResults.savedStorage, null);
  assert.equal(probeResults.timeout.errors[0].code, 'preview-unavailable');
  assert.equal(probeResults.abortName, 'AbortError');
  assert.deepEqual(probeResults.hostile.errors, [], 'script delimiters in a token do not break startup');
  assert.equal(probeResults.injected, false, 'token data cannot inject an HTML script');
  assert.deepEqual(probeResults.fetchCounts, [1, 0], 'the tracker preserves the exact token and reports fetch completion');
  assert.equal(probeResults.remainingFrames, 0);
  await probe.close();

  const plain = await newPage();
  const noEnv = { ...files, 'src/main.jsx': standalone, 'index.html': files['index.html'].replace('%VITE_TITLE%', 'Plain site') };
  delete noEnv['.env'];
  delete noEnv['.env.example'];
  await upload(plain, noEnv);
  await plain.getByRole('button', { name: 'Open site', exact: true }).waitFor();
  assert.equal(await plain.getByText('This site needs a few settings').count(), 0);
  assert.deepEqual(errors, []);
  console.log('ZIP import environment UI: settings, reasoning, review-loop recovery, runtime blog repair before import, pending fetches, cancellation, timeout, storage isolation and ordinary imports passed.');
} finally { await browser.close(); }
