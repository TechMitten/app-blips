import { CheckCircle2, LogOut, X } from 'lucide-react';
import Modal from './Modal';

// Transient "you're signed in/out" notification. Auto-dismissed by useAuth;
// the X button just dismisses early. Rendered above other modals (zIndex 90)
// so it stays visible even when e.g. the import offer opens on sign-in.
export default function AuthToast({ kind, onDismiss }) {
  const signedIn = kind === 'signedIn';
  const Icon = signedIn ? CheckCircle2 : LogOut;

  return (
    <Modal
      zIndex={90}
      scrimClass="fixed inset-x-0 top-6 flex justify-center px-4 pointer-events-none"
      cardClass="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl bg-surface px-5 py-4 shadow-xl border border-slate-200 animate-scale-in"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
        signedIn ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
      }`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">
          {signedIn ? 'Signed in' : 'Signed out'}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {signedIn
            ? 'Welcome Back!! Your apps are now syncing to your account.'
            : 'You have been signed out of your account.'}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </Modal>
  );
}
