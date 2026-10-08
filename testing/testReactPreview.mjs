// Run: node testing/testReactPreview.mjs  (needs network for esm.sh)
// Renders a JSX app through the real preview pipeline (compile + loop guards +
// bridge) in a sandboxed srcdoc frame, proving the import map in the app
// prompt loads a single working React with lucide-react icons.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { injectPreviewBridge } from '../src/previewBridge.js';
import { REACT_IMPORTS } from '../src/lib/jsxCompile.js';

const app = `<!DOCTYPE html>
<html lang="en">
<head>
  <script type="importmap">{"imports":{
    "react": "${REACT_IMPORTS.react}",
    "react/jsx-runtime": "${REACT_IMPORTS['react/jsx-runtime']}",
    "react-dom/client": "${REACT_IMPORTS['react-dom/client']}",
    "lucide-react": "https://esm.sh/lucide-react@0.468.0?external=react"
  }}</script>
</head>
<body>
  <div id="app"></div>
  <script type="text/jsx">
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { Heart } from 'lucide-react';
    function App() {
      const [count, setCount] = useState(0);
      const [text, setText] = useState('');
      return (
        <main>
          <button id="inc" onClick={() => setCount(count + 1)}><Heart size={16} /> {count}</button>
          <input id="field" value={text} onChange={(e) => setText(e.target.value)} />
          <p id="echo">{text}</p>
        </main>
      );
    }
    createRoot(document.getElementById('app')).render(<App />);
  </script>
</body>
</html>`;

const { srcDoc } = injectPreviewBridge(app, {});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setContent('<iframe sandbox="allow-scripts allow-forms" style="width:600px;height:400px"></iframe>');
  await page.$eval('iframe', (el, doc) => { el.srcdoc = doc; }, srcDoc);
  const frame = page.frameLocator('iframe');
  await frame.locator('#inc').waitFor({ timeout: 20000 });
  assert.equal(await frame.locator('#inc svg').count(), 1, 'lucide-react icon renders');
  await frame.locator('#inc').click();
  await frame.locator('#inc').click();
  assert.equal((await frame.locator('#inc').innerText()).trim(), '2', 'state updates on click');
  await frame.locator('#field').fill('hello');
  assert.equal(await frame.locator('#echo').innerText(), 'hello', 'controlled input updates');
  assert.deepEqual(errors.filter((e) => !/favicon/i.test(e)), [], 'no console errors');
} finally {
  await browser.close();
}
console.log('testReactPreview: ok');
