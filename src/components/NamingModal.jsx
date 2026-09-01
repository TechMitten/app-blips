import { Edit2, X } from 'lucide-react';
import Modal from './Modal';

// Asks for a name before the first generation (or before starting a new app).
// The name state itself stays in App because the generate-after-naming flow
// reads it.
export default function NamingModal({ name, onNameChange, onConfirm, onCancel }) {
  return (
    <Modal zIndex={65}>
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-base 2xl:text-lg font-semibold text-slate-900">Name Your App</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>
      <form onSubmit={onConfirm} className="p-6 space-y-5">
        <div className="space-y-3">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">App Name</label>
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-500 transition-colors">
              <Edit2 size={16} />
            </div>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-3 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="e.g. Recipe Assistant, Task Manager..."
            />
          </div>
          <p className="text-xs text-slate-400">Helps you find this app later.</p>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className={`rounded-lg px-5 py-2 font-semibold transition-colors active:scale-[0.98] ${
              !name.trim()
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'brand-fill-text bg-brand text-white hover:bg-brand-hover shadow-sm'
            }`}
          >
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
