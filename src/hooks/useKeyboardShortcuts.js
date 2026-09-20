import { useEffect, useRef } from 'react';
import { hasCommandModifier, isTypingTarget } from '../lib/shortcuts';

// Workspace keyboard shortcuts.
//
// Deliberately a short list, and every binding maps to a control that is
// already visible in the top chrome -- so a shortcut is an accelerator, never
// a second hidden way to drive the app. Each one is printed in its control's
// tooltip via SHORTCUT_HINTS, which is why both live in lib/shortcuts.js.
//
// The preview iframe needs no special handling: it is sandboxed WITHOUT
// allow-same-origin, so keystrokes inside a generated app never reach here.
export default function useKeyboardShortcuts({ onUndo, onRedo, onOpenApps, onOpenHelp, isBusy }) {
  // Held in a ref so the listener is bound once. The callbacks are rebuilt on
  // every App render, and re-subscribing document-wide that often is waste.
  const latest = useRef({});
  useEffect(() => {
    latest.current = { onUndo, onRedo, onOpenApps, onOpenHelp, isBusy };
  });

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat) return;
      // Never steal a keystroke aimed at the prompt box or a form field.
      if (isTypingTarget(event.target)) return;
      // A modal owns the keyboard while it is open, and the mobile drawer
      // marks the workspace inert. Both are cheap to detect and save threading
      // a dozen isOpen booleans through here.
      if (document.querySelector('.modal-scrim')) return;
      if (document.getElementById('root')?.inert) return;

      const { onUndo: undo, onRedo: redo, onOpenApps: apps, onOpenHelp: help, isBusy: busy } = latest.current;
      const key = event.key.toLowerCase();

      if (hasCommandModifier(event)) {
        // Version moves are blocked mid-build: switchVersion refuses while a
        // generation is in flight, so the keystroke would be a silent no-op.
        if (key === 'z') {
          if (busy) return;
          event.preventDefault();
          (event.shiftKey ? redo : undo)?.();
        } else if (key === 'y') {
          if (busy) return;
          event.preventDefault();
          redo?.();
        } else if (key === 'k') {
          event.preventDefault();
          apps?.();
        }
        return;
      }

      // Bare "?" -- shift is part of producing the glyph, so it is not checked.
      if (event.key === '?' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        help?.();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
