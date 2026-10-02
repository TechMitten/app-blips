import { useEffect, useState } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { onDesktopStorageError, dismissDesktopStorageError } from '../lib/desktop';

// Desktop app only: surfaces a failed disk write (lib/desktop.js writes in the
// background, so the code that triggered it has already moved on). Shows the
// latest failure until dismissed.
export default function DesktopStorageNotice() {
  const [message, setMessage] = useState(null);

  useEffect(() => onDesktopStorageError(setMessage), []);

  if (!message) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[95] w-[calc(100%-2rem)] max-w-lg flex items-start gap-3 rounded-xl border border-red-200 bg-surface px-4 py-3 shadow-xl text-sm text-slate-700"
    >
      <CircleAlert size={18} className="text-red-500 shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0 break-words">
        {message}. Your latest changes may not be saved to disk; check that the projects folder (Settings → Data) is writable.
      </span>
      <button
        type="button"
        onClick={dismissDesktopStorageError}
        className="text-slate-400 hover:text-slate-700 p-1 -m-1 rounded-lg transition-colors"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
