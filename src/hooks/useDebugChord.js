import { useEffect, useRef } from 'react';
import { isDebugChord } from '../lib/shortcuts';

// Calls `onChord` for the secret debug chord. Kept apart from
// useKeyboardShortcuts on purpose: that hook is a list of accelerators for
// visible controls, and this one is meant to be undiscoverable.
export default function useDebugChord(onChord) {
  const latest = useRef(onChord);
  useEffect(() => {
    latest.current = onChord;
  });

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.repeat || !isDebugChord(event)) return;
      // Also suppresses the browser's own binding for this chord.
      event.preventDefault();
      latest.current?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
