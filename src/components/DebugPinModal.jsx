import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import Modal, { ModalCloseButton } from './Modal';

// PIN prompt for the hidden raw-LLM-log panel. The PIN is verified server-side
// (functions/_lib/debugUnlock.js); this only collects it. Error copy is
// deliberately generic so a stranger who finds the chord learns nothing.
export default function DebugPinModal({ onClose, onUnlocked }) {
  const inputRef = useRef(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !pin) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/debug-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (response.status === 429) {
        const wait = response.headers.get('Retry-After');
        setError(wait ? `Too many attempts. Try again in about ${wait}s.` : 'Too many attempts. Try again later.');
      } else {
        const data = await response.json().catch(() => null);
        if (response.ok && data?.ok) {
          onUnlocked();
          return;
        }
        setError(response.ok ? 'Incorrect PIN.' : 'Unavailable.');
      }
      setPin('');
      inputRef.current?.focus();
    } catch {
      setError('Unavailable.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal zIndex={80} cardClass="w-full max-w-xs bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
      <form onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Lock size={15} className="text-slate-400" /> Enter PIN
          </h2>
          <ModalCloseButton onClick={onClose} />
        </div>
        <div className="p-5 space-y-3">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            aria-label="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-center tracking-[0.4em] text-slate-900 outline-none focus:border-slate-400"
          />
          {error && <p role="alert" className="text-sm text-red-500 text-center">{error}</p>}
        </div>
        <div className="bg-slate-50 px-5 py-3 flex justify-end">
          <button
            type="submit"
            disabled={busy || !pin}
            className="brand-fill-text rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
