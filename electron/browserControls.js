// Commands operate only on the app's embedded generated-page frame. Never
// accept JavaScript, arbitrary selectors, or screen coordinates from the model.
const FRAME_GEOMETRY = `(() => {
  const frame = document.querySelector('iframe[data-appblips-browser]');
  if (!frame) return null;
  const rect = frame.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    token: frame.dataset.browserToken, focused: document.activeElement === frame };
})()`;

export async function executeBrowserInput(window, args) {
  if (!window || window.isDestroyed()) throw new Error('Browser window is unavailable.');
  if (!args || typeof args.token !== 'string') throw new Error('Missing browser document token.');
  const contents = window.webContents;
  const frame = await contents.executeJavaScript(FRAME_GEOMETRY);
  if (!frame || frame.token !== args.token || frame.width < 1 || frame.height < 1) throw new Error('Browser document changed. Inspect it again.');
  const [width, height] = window.getContentSize();
  if (args.action === 'screenshot') {
    const visible = await contents.executeJavaScript(`document.elementFromPoint(${Math.round(frame.x + frame.width / 2)}, ${Math.round(frame.y + frame.height / 2)}) === document.querySelector('iframe[data-appblips-browser]')`);
    if (!visible) throw new Error('Browser is covered by another part of the app.');
    const x = Math.max(0, Math.ceil(frame.x));
    const y = Math.max(0, Math.ceil(frame.y));
    const rect = { x, y, width: Math.floor(Math.min(width, frame.x + frame.width) - x), height: Math.floor(Math.min(height, frame.y + frame.height) - y) };
    if (rect.width <= 0 || rect.height <= 0) throw new Error('Browser is outside the visible workspace.');
    return { dataUrl: (await contents.capturePage(rect)).toDataURL(), croppedToVisibleArea: true };
  }
  if (!['click', 'type', 'press'].includes(args.action)) throw new Error('Unsupported browser input.');
  if (![args.x, args.y].every(Number.isFinite) || args.x < 0 || args.x > 1 || args.y < 0 || args.y > 1) throw new Error('Browser coordinates must be inside the frame.');
  const x = Math.round(frame.x + args.x * frame.width);
  const y = Math.round(frame.y + args.y * frame.height);
  if (x < 0 || y < 0 || x >= width || y >= height) throw new Error('Target is outside the visible browser area.');
  const visible = await contents.executeJavaScript(`document.elementFromPoint(${x}, ${y}) === document.querySelector('iframe[data-appblips-browser]')`);
  if (!visible) throw new Error('Browser target is covered by another part of the app.');
  if (args.action === 'type' && (typeof args.text !== 'string' || args.text.length > 2000)) throw new Error('Text must be at most 2000 characters.');
  const keys = {
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  };
  if (args.action === 'press' && !Object.hasOwn(keys, args.key)) throw new Error('Unsupported browser key.');
  window.focus();
  // Use Chromium's input routing so events reach sandboxed child frames even
  // when they run in a separate renderer. Never expose general CDP commands.
  const attachedHere = !contents.debugger.isAttached();
  if (attachedHere) contents.debugger.attach('1.3');
  try {
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    if (args.action === 'click') {
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } else {
      const current = await contents.executeJavaScript(FRAME_GEOMETRY);
      if (current?.token !== args.token || !current.focused) throw new Error('Browser lost focus or navigated.');
      if (args.action === 'type') {
        const select = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: process.platform === 'darwin' ? 4 : 2 };
        await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...select });
        await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...select });
        await contents.debugger.sendCommand('Input.insertText', { text: args.text });
      }
      else {
        const key = keys[args.key];
        await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...key, ...(args.key === 'Enter' ? { text: '\r' } : args.key === 'Space' ? { text: ' ' } : {}) });
        // Give a game's update loop a chance to observe the pressed key.
        await new Promise((resolve) => setTimeout(resolve, 100));
        await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
      }
    }
  } finally { if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach(); }
  return { success: true, inputMode: 'native browser input' };
}
