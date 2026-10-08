// Run: env -u ELECTRON_RUN_AS_NODE xvfb-run -a node_modules/.bin/electron testing/testBrowserInput.js --no-sandbox
// Uses real Electron input against an origin-isolated embedded browser.
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { executeBrowserInput } from '../electron/browserControls.js';
import { injectPreviewBridge } from '../src/previewBridge.js';

async function run() {
  const window = new BrowserWindow({ width: 900, height: 650, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    const code = `<!DOCTYPE html><html><head><title>Native test</title></head><body>
    <form id="form"><label for="task">Task</label><input id="task"><button>Save</button></form><p id="output"></p><p id="key"></p>
    <label for="amount">Amount</label><input id="amount" type="number" value="123">
    <script>
      document.getElementById('form').onsubmit = event => { event.preventDefault(); document.getElementById('output').textContent = document.getElementById('task').value + ' trusted=' + event.isTrusted; };
      document.addEventListener('keydown', event => { if (event.key === 'ArrowRight') document.getElementById('key').textContent = event.key + ' trusted=' + event.isTrusted; });
    </script></body></html>`;
    const { srcDoc, token } = injectPreviewBridge(code);
    await window.loadURL('data:text/html,' + encodeURIComponent('<html><body style="margin:0"><p>Parent controls</p><iframe data-appblips-browser style="width:600px;height:400px;border:0" sandbox="allow-scripts allow-forms"></iframe></body></html>'));
    await window.webContents.executeJavaScript(`(() => { const frame = document.querySelector('iframe'); frame.dataset.browserToken = ${JSON.stringify(token)}; frame.srcdoc = ${JSON.stringify(srcDoc)}; })()`);
    const request = (args) => window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const frame = document.querySelector('iframe');
      const requestId = 'request-' + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Browser timed out')); }, 5000);
      function receive(event) {
        if (event.source !== frame.contentWindow || event.data.token !== ${JSON.stringify(token)} || event.data.type !== 'browser-result' || event.data.payload.requestId !== requestId) return;
        clearTimeout(timer); window.removeEventListener('message', receive);
        if (event.data.payload.error) reject(new Error(event.data.payload.error)); else resolve(event.data.payload.result);
      }
      window.addEventListener('message', receive);
      frame.contentWindow.postMessage({ __orion: 'orion-preview-bridge', v: 1, token: ${JSON.stringify(token)}, type: 'browser-action', payload: { ...${JSON.stringify(args)}, requestId } }, '*');
    })`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    let snapshot = await request({ action: 'inspect' });
    const field = snapshot.elements.find((item) => item.label === 'Task');
    assert.ok(field);
    const act = async (action, id, extra) => {
      const point = await request({ action: 'target', target: id, focus: action !== 'click', select: action === 'type' });
      const result = await executeBrowserInput(window, { action, token, x: point.x / point.width, y: point.y / point.height, ...extra });
      assert.equal(result.inputMode, 'native browser input');
      await new Promise((resolve) => setTimeout(resolve, 200));
    };
    await act('type', field.id, { text: 'Native task' });
    snapshot = await request({ action: 'inspect' });
    assert.equal(snapshot.elements.find((item) => item.label === 'Task').value, 'Native task');
    const button = snapshot.elements.find((item) => item.label === 'Save');
    await act('click', button.id);
    snapshot = await request({ action: 'inspect' });
    assert.match(snapshot.text, /Native task trusted=true/);
    await act('type', field.id, { text: 'Replacement task' });
    await act('press', field.id, { key: 'Enter' });
    snapshot = await request({ action: 'inspect' });
    assert.match(snapshot.text, /Replacement task trusted=true/, 'typing replaces the field and Enter submits through the browser');
    await act('press', field.id, { key: 'ArrowRight' });
    snapshot = await request({ action: 'inspect' });
    assert.match(snapshot.text, /ArrowRight trusted=true/);
    await act('type', snapshot.elements.find((item) => item.label === 'Amount').id, { text: '456' });
    snapshot = await request({ action: 'inspect' });
    assert.equal(snapshot.elements.find((item) => item.label === 'Amount').value, '456', 'native typing replaces numeric fields too');
    const capture = await executeBrowserInput(window, { action: 'screenshot', token });
    assert.match(capture.dataUrl, /^data:image\/png;base64,/);
    const png = Buffer.from(capture.dataUrl.split(',')[1], 'base64');
    assert.equal(png.readUInt32BE(16), 600, 'screenshot is cropped to the embedded browser');
    assert.equal(png.readUInt32BE(20), 400);
    await assert.rejects(executeBrowserInput(window, { action: 'click', token: 'old', x: .5, y: .5 }), /document changed/);
    await assert.rejects(executeBrowserInput(window, { action: 'click', token, x: 2, y: .5 }), /inside the frame/);
    await assert.rejects(executeBrowserInput(window, { action: 'press', token, x: .5, y: .5, key: 'F12' }), /Unsupported browser key/);
    await window.webContents.executeJavaScript(`(() => { const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;z-index:100;background:white'; document.body.appendChild(cover); })()`);
    await assert.rejects(executeBrowserInput(window, { action: 'click', token, x: .5, y: .5 }), /covered/);
    await assert.rejects(executeBrowserInput(window, { action: 'screenshot', token }), /covered/);
    console.log('testBrowserInput: ok (native clicks, typing, Enter, game key, screenshots, and input boundaries)');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}
app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1); });
