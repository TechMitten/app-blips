import { useEffect } from 'react';
import Modal, { ModalCloseButton } from './Modal';
import { PRIMARY_BUTTON } from './SettingControls';
import { CONNECTOR_DEFINITIONS } from '../lib/connectors';

// "How it works" for one connector, opened from its settings page. The text
// lives in the connector's `about` (lib/connectors.js) so every connector gets
// the same dialog. Sits above the Settings modal (z 60), like its confirms.
export default function ConnectorInfoModal({ id, onClose }) {
  const { name, about } = CONNECTOR_DEFINITIONS[id];

  // Escape closes only this dialog, not the Settings modal underneath.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <Modal
      zIndex={70}
      cardClass="w-full max-w-md xl:max-w-lg bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[90vh]"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'connector-info-title' }}
    >
      <div className="shrink-0 px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <h2 id="connector-info-title" className="text-base 2xl:text-lg font-semibold text-slate-900">
          How {name} works
        </h2>
        <ModalCloseButton onClick={onClose} />
      </div>
      <div className="p-6 space-y-5 overflow-y-auto text-sm leading-relaxed text-slate-700">
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">What it does</h3>
          <p>{about.what}</p>
        </section>
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">How it works</h3>
          <ol className="list-decimal space-y-1.5 pl-5">
            {about.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </section>
        {about.notes?.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Good to know</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              {about.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        )}
      </div>
      <div className="shrink-0 bg-slate-50 px-6 py-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          autoFocus
          className={PRIMARY_BUTTON}
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}
