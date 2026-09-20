import Modal, { ModalCloseButton } from './Modal';

// Generic header/body/footer confirmation dialog (delete app, start new app).
// `children` is the message body; `confirmClass` styles the confirm button.
export default function ConfirmModal({
  title,
  subtitle,
  onClose,
  onConfirm,
  confirmLabel,
  busyLabel,
  busy = false,
  confirmDisabled = false,
  confirmClass,
  icon: Icon,
  children,
}) {
  return (
    <Modal zIndex={70}>
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-base 2xl:text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>
      <div className="p-6 space-y-4">
        {children}
      </div>
      <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
        >
          Cancel
        </button>
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
