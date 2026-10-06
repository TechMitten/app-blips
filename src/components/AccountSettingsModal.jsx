import { User, Mail, X, LogOut } from 'lucide-react';

// Accounts sign in with Google or GitHub, so there's no password to manage
// here: just who you are and the permanent username.
export default function AccountSettingsModal({ user, username, usernameLoading, onClose, onSignOut }) {
  return (
    <div className="modal-scrim fixed inset-0 z-[80] bg-scrim backdrop-blur-sm flex items-center justify-center p-4">
      <div className="modal-card w-full max-w-md xl:max-w-lg bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
              <User size={18} />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Account Settings</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { onSignOut(); onClose(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors mr-2"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm">
                <Mail size={16} />
                <span>{user?.email}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">From the Google or GitHub account you sign in with.</p>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100">
              <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm">
                <User size={16} />
                <span>{usernameLoading ? 'Loading...' : (username || 'Not set yet')}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {username
                  ? "Your username is permanent and used in your app's public URLs."
                  : "You'll choose a username the first time you deploy an app. It can't be changed once set."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
