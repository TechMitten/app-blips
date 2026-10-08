// Serialized into the sandboxed frame. No parent DOM or Electron APIs are
// exposed here; only bounded observations and actions on the generated page.
export function createBrowserRuntime() {
  const nodes = new Map();
  const ids = new WeakMap();
  const errors = [];
  let nextId = 0;
  let cursor;
  const reportError = (message) => {
    errors.push(String(message).slice(0, 1000));
    if (errors.length > 20) errors.shift();
  };
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const markCursor = (x, y) => {
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.setAttribute('data-orion-browser-cursor', 'true');
      cursor.style.cssText = 'position:fixed;width:18px;height:18px;border:3px solid #7c3aed;border-radius:50%;background:#c4b5fd66;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)';
      document.documentElement.appendChild(cursor);
    }
    cursor.style.left = x + 'px';
    cursor.style.top = y + 'px';
  };
  const inspect = () => {
    for (const [id, el] of nodes) if (!el.isConnected) nodes.delete(id);
    const elements = [];
    for (const el of document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="tab"],[contenteditable="true"],canvas')) {
      if (!visible(el)) continue;
      let id = ids.get(el);
      if (!id) { id = 'e' + (++nextId); ids.set(el, id); }
      nodes.set(id, el);
      const rect = el.getBoundingClientRect();
      elements.push({ id, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), type: el.getAttribute('type'),
        label: (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || '').slice(0, 180),
        value: el.type === 'password' ? '[hidden]' : typeof el.value === 'string' ? el.value.slice(0, 300) : undefined,
        checked: typeof el.checked === 'boolean' ? el.checked : undefined,
        disabled: !!el.disabled, href: el.getAttribute('href'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
      if (elements.length >= 100) break;
    }
    return { title: document.title, readyState: document.readyState, focusedElement: ids.get(document.activeElement) || document.activeElement?.tagName,
      text: (document.body?.innerText || '').slice(0, 12000), elements,
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY }, errors: errors.slice() };
  };
  const act = (args) => {
    if (args.action === 'inspect') return inspect();
    if (args.action === 'scroll') {
      const amount = Number(args.y);
      if (!Number.isFinite(amount) || Math.abs(amount) > 5000) throw new Error('Scroll amount must be between -5000 and 5000.');
      window.scrollBy(0, amount);
      return { success: true };
    }
    if (args.action === 'point') {
      if (![args.x, args.y].every(Number.isFinite) || args.x < 0 || args.y < 0 || args.x >= innerWidth || args.y >= innerHeight) throw new Error('Point must be inside the browser viewport.');
      markCursor(args.x, args.y);
      return { x: args.x, y: args.y, width: innerWidth, height: innerHeight };
    }
    const coordinateClick = args.action === 'click' && !args.target && [args.x, args.y].every(Number.isFinite);
    if (coordinateClick && (args.x < 0 || args.y < 0 || args.x >= innerWidth || args.y >= innerHeight)) throw new Error('Point must be inside the browser viewport.');
    const el = coordinateClick ? document.elementFromPoint(args.x, args.y) : nodes.get(args.target);
    if (!el?.isConnected) throw new Error('Element is no longer available. Inspect the page again.');
    if (el.disabled) throw new Error('Element is disabled.');
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    const x = coordinateClick ? args.x : Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2));
    const y = coordinateClick ? args.y : Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2));
    if (!el.contains(document.elementFromPoint(x, y))) throw new Error('Element is covered by another element.');
    markCursor(x, y);
    if (args.action === 'target') {
      if (args.focus) {
        if (el.tagName === 'CANVAS') el.tabIndex = -1;
        el.focus({ preventScroll: true });
        if (args.select && typeof el.select === 'function') el.select();
        else if (args.select && el.isContentEditable) {
          const range = document.createRange(); range.selectNodeContents(el);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        }
      }
      return { x, y, width: innerWidth, height: innerHeight,
        acceptsText: ['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable };
    }
    if (args.action === 'click') {
      for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse', button: 0 }));
      for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    }
    else if (args.action === 'type') {
      if (typeof args.text !== 'string' || args.text.length > 2000) throw new Error('Text must be at most 2000 characters.');
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.isContentEditable) throw new Error('Element does not accept text.');
      el.focus();
      if (el.isContentEditable) el.textContent = args.text;
      else {
        const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, args.text);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (args.action === 'press') {
      const keys = { Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Space: ' ', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
      if (!(args.key in keys)) throw new Error('Unsupported key.');
      el.focus();
      const event = new KeyboardEvent('keydown', { key: keys[args.key], code: args.key, bubbles: true, cancelable: true });
      const proceed = el.dispatchEvent(event);
      el.dispatchEvent(new KeyboardEvent('keyup', { key: keys[args.key], code: args.key, bubbles: true }));
      if (proceed && args.key === 'Enter' && el.form) el.form.requestSubmit();
      else if (proceed && ['Enter', 'Space'].includes(args.key) && el.tagName === 'BUTTON') el.click();
    } else throw new Error('Unsupported browser action.');
    return { success: true, inputMode: 'DOM events' };
  };
  return { inspect, act, reportError };
}

export const BROWSER_RUNTIME_SOURCE = `var browserRuntime = (${createBrowserRuntime.toString()})();`;
