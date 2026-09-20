import { useEffect, useState } from 'react';
import { CheckCircle2, LogOut, X } from 'lucide-react';
import Modal from './Modal';

const EXIT_MS = 180;

// Transient "you're signed in/out" modal, centered on screen. Auto-dismissed
// by useAuth (4s); the X button dismisses early. Rendered
// above other modals (zIndex 90) so it stays visible even when e.g. the import
// offer opens on sign-in.
//
// `kind` becomes null when dismissed; we keep the last kind mounted just long
// enough to play the exit animation, then unmount.
export default function AuthToast({ kind, onDismiss }) {
  const [shown, setShown] = useState(kind);
  if (kind && kind !== shown) setShown(kind);
  const leaving = !kind && !!shown;

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setShown(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (!shown) return null;

  const signedIn = shown === 'signedIn';
  const Icon = signedIn ? CheckCircle2 : LogOut;

  return (
    <Modal
      zIndex={90}
      scrimClass={`fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4 ${
        leaving ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
      cardClass={`relative w-full max-w-sm flex flex-col items-center text-center gap-3 rounded-2xl bg-surface px-8 py-8 shadow-xl border border-slate-200 ${
        leaving ? 'animate-scale-out' : 'animate-scale-in'
      }`}
      cardProps={{ role: 'status', 'aria-live': 'polite' }}
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
        signedIn ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
      }`}>
        <Icon size={28} />
      </div>
      <div>
        <p className="text-lg font-semibold text-slate-900">
          {signedIn ? 'Signed in' : 'Signed out'}
        </p>
        <p className="text-sm text-slate-500 mt-1">
          {signedIn
            ? 'Welcome Back!! Your apps are now syncing to your account.'
            : 'You have been signed out of your account.'}
        </p>
      </div>
    </Modal>
  );
}
