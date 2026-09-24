import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useDebugChord from '../hooks/useDebugChord';
import { useRawLogEnabled, useRawLogEntries } from '../hooks/useRawLog';
import { setRawLogEnabled } from '../lib/rawLog';
import { DEBUG_UNLOCKED_KEY, safeStorage } from '../lib/config';
import DebugPinModal from './DebugPinModal';
import RawLogPanel from './RawLogPanel';

// The whole hidden raw-log feature behind one mount point: chord -> PIN ->
// panel. Portaled to <body> so it is unaffected by the workspace's `inert`
// handling on #root, and rendered outside App so it works in every screen
// (studio picker included). Renders nothing until the chord is pressed.
export default function DebugTools() {
  const enabled = useRawLogEnabled();
  const entries = useRawLogEntries();
  const [pinOpen, setPinOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // A reload keeps the tab unlocked (log restarts empty); a new tab does not.
  useEffect(() => {
    if (safeStorage('session')?.getItem(DEBUG_UNLOCKED_KEY) === '1') setRawLogEnabled(true);
  }, []);

  useDebugChord(() => {
    if (enabled) setPanelOpen((open) => !open);
    else setPinOpen(true);
  });

  // Squeeze the app beside the drawer (see the raw-log-open rule in index.css).
  // A body class rather than App state, so App never needs to know about it.
  const drawerOpen = enabled && panelOpen;
  useEffect(() => {
    document.body.classList.toggle('raw-log-open', drawerOpen);
    return () => document.body.classList.remove('raw-log-open');
  }, [drawerOpen]);

  const handleUnlocked = () => {
    safeStorage('session')?.setItem(DEBUG_UNLOCKED_KEY, '1');
    setRawLogEnabled(true);
    setPinOpen(false);
    setPanelOpen(true);
  };

  const handleLock = () => {
    safeStorage('session')?.removeItem(DEBUG_UNLOCKED_KEY);
    setRawLogEnabled(false);
    setPanelOpen(false);
  };

  return createPortal(
    <>
      {pinOpen && !enabled && <DebugPinModal onClose={() => setPinOpen(false)} onUnlocked={handleUnlocked} />}
      {enabled && panelOpen && <RawLogPanel entries={entries} onClose={() => setPanelOpen(false)} onLock={handleLock} />}
    </>,
    document.body,
  );
}
