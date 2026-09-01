import { X } from 'lucide-react';

const DEFAULT_SCRIM_CLASS = 'fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4';
const DEFAULT_CARD_CLASS = 'w-full max-w-md xl:max-w-lg 2xl:max-w-xl bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in';

// Shared scrim + card shell for the app's modals. `zIndex` is applied inline
// (Tailwind can't generate dynamic z-[n] classes), and `scrimClass` /
// `cardClass` replace the defaults wholesale for the few modals whose shell
// differs (Settings, ProjectsList).
export default function Modal({
  zIndex = 60,
  scrimClass = DEFAULT_SCRIM_CLASS,
  cardClass = DEFAULT_CARD_CLASS,
  cardProps,
  children,
}) {
  return (
    <div className={scrimClass} style={{ zIndex }}>
      <div className={cardClass} {...cardProps}>
        {children}
      </div>
    </div>
  );
}

export function ModalCloseButton({ onClick, label = 'Close', disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors ${disabled ? 'disabled:opacity-50 disabled:cursor-not-allowed' : ''}`}
    >
      <X size={18} />
    </button>
  );
}
