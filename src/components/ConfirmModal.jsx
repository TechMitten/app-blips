import Modal, { ModalCloseButton } from './Modal';

// Generic header/body/footer confirmation dialog (delete app, start new app).
// `children` is the message body; `confirmClass` styles the confirm button.
// An optional secondary action (e.g. "Discard changes") sits between Cancel
// and the confirm button.
export default function ConfirmModal({
  title,
  subtitle,
  onClose,
  onConfirm,
  confirmLabel,
  cancelLabel = 'Cancel',
  secondaryLabel,
  onSecondary,
  busyLabel,
  busy = false,
  confirmDisabled = false,
  confirmClass,
  icon: Icon,
  children,
}) {
  return (
    <Modal
      zIndex={70}
      cardClass="w-full max-w-md xl:max-w-lg 2xl:max-w-xl bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[90vh]"
    >
      <div className="shrink-0 px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-base 2xl:text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>
      <div className="p-6 space-y-4 overflow-y-auto">
        {children}
      </div>
      <div className="shrink-0 bg-slate-50 px-6 py-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
        >
          {cancelLabel}
        </button>
        {secondaryLabel && (
          <button
            type="button"
            onClick={onSecondary}
            disabled={busy}
            className="rounded-lg px-4 py-2 font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || confirmDisabled}
          className={confirmClass}
        >
          {Icon && <Icon size={14} />}
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
