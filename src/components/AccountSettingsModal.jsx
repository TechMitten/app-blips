import { useState } from 'react';
import authProvider from '../lib/auth';
import { User, Mail, KeyRound, X, LogOut } from 'lucide-react';

export default function AccountSettingsModal({ user, username, usernameLoading, onClose, onSignOut }) {
  const [activeTab, setActiveTab] = useState('profile'); // profile, security
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      await authProvider.updatePassword(password);
      setMessage('Password updated successfully.');
      setPassword('');
      setConfirmPassword('');
    } catch (updateError) {
      setError(updateError.message);
    }
    setLoading(false);
  };

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

        <div className="flex flex-wrap border-b border-slate-100 px-2">
          <button 
            onClick={() => { setActiveTab('profile'); setMessage(''); setError(''); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'profile' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Profile
          </button>
          <button 
            onClick={() => { setActiveTab('security'); setMessage(''); setError(''); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'security' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Security
          </button>
        </div>

        <div className="p-6">
          {message && (
            <div className="mb-4 rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800 leading-relaxed">
              {message}
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800 leading-relaxed">
              {error}
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm">
                  <Mail size={16} />
                  <span>{user?.email}</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">Your email address is used for sign in and notifications.</p>
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
          )}

          {activeTab === 'security' && (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                <div className="relative">
                  <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-surface border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="Enter new password"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                <div className="relative">
                  <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-surface border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="Confirm new password"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || !password}
                className="brand-fill-text w-full py-2.5 px-4 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
