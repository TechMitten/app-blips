import { CloudUpload, X, Loader2 } from 'lucide-react';
import Modal from './Modal';

// One-time offer to copy locally-saved guest projects into the just-signed-in
// account. Never shown again once imported or skipped.
export default function ImportModal({ localCount, importing, onImport, onSkip }) {
  return (
    <Modal zIndex={80}>
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
            <CloudUpload size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Bring your apps to the cloud?</h2>
            <p className="text-xs text-slate-400 mt-0.5">Found {localCount} saved in this browser.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-slate-600 leading-relaxed">
          Import your existing {localCount} app{localCount !== 1 ? 's' : ''} into your account so they sync across devices? This happens once and won't be offered again.
        </div>
      </div>
      <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={importing}
          className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors active:scale-[0.98] ${
            importing
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'brand-fill-text bg-brand text-white hover:bg-brand-hover shadow-sm'
          }`}
        >
          {importing && <Loader2 className="animate-spin" size={15} />}
          {importing ? 'Importing...' : 'Import'}
        </button>
      </div>
    </Modal>
  );
}
