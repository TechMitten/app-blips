// Workspace keyboard shortcuts.
//
// The printable hint lives here beside the matcher it describes, so a tooltip
// can never advertise a key the handler does not listen for.

const isApple = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

// Apple keyboards print the glyph; everywhere else the word is clearer.
export const MOD_KEY = isApple ? '⌘' : 'Ctrl';

export const SHORTCUT_HINTS = {
  undo: isApple ? '⌘Z' : 'Ctrl+Z',
  redo: isApple ? '⇧⌘Z' : 'Ctrl+⇧Z',
  apps: isApple ? '⌘K' : 'Ctrl+K',
  help: '?',
};

// The platform's own "command" modifier, and only that one -- accepting either
// Ctrl or Meta would swallow Ctrl+Z inside a macOS text field.
export function hasCommandModifier(event) {
  return isApple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

// A shortcut must never steal a keystroke aimed at the prompt box, a modal
// field, or the rename input. The preview iframe needs no guard: it is
// sandboxed without allow-same-origin, so its keystrokes never reach us.
export function isTypingTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}
