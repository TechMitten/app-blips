import React, { useState, useEffect } from 'react';
import authProvider from '../lib/auth';
import { User, Mail, KeyRound, Trash2, X, AlertTriangle, LogOut } from 'lucide-react';

export default function AccountSettingsModal({ user, onClose, onSignOut }) {
  const [activeTab, setActiveTab] = useState('profile'); // profile, security, danger
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const currentUsername = user?.displayName || user?.username || user?.user_metadata?.username || '';
  const [username, setUsername] = useState(currentUsername);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setUsername(currentUsername);
  }, [currentUsername]);

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

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername) {
      setError('Username cannot be empty');
      return;
    }
    // Basic username validation: only letters, numbers, hyphens
    if (!/^[a-zA-Z0-9-]+$/.test(cleanUsername)) {
      setError('Username can only contain letters, numbers, and hyphens');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      await authProvider.updateProfile({ displayName: cleanUsername });
      setUsername(cleanUsername);
      setMessage('Profile updated successfully.');
    } catch (updateError) {
      setError(updateError.message);
    }
    setLoading(false);
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Are you absolutely sure you want to delete your account? This action cannot be undone.')) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authProvider.deleteAccount();
      onSignOut();
      onClose();
    } catch (deleteError) {
      console.warn("Could not delete user:", deleteError);
      setError('Account deletion requires recent authentication. Please sign out and sign back in before deleting your account. ' + deleteError.message);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-scrim backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md xl:max-w-lg bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
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

        <div className="flex border-b border-slate-100 px-2">
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
          <button 
            onClick={() => { setActiveTab('danger'); setMessage(''); setError(''); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'danger' ? 'border-rose-600 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Danger Zone
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
              <form onSubmit={handleUpdateProfile} className="space-y-4 mt-4 pt-4 border-t border-slate-100">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-surface border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      placeholder="Choose a username"
                      required
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Your username is used for custom app URLs.</p>
                </div>
                <button
                  type="submit"
                  disabled={loading || !username.trim() || username.trim().toLowerCase() === currentUsername}
                  className="brand-fill-text w-full py-2.5 px-4 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Updating...' : 'Save Profile'}
                </button>
              </form>
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

          {activeTab === 'danger' && (
            <div className="space-y-4">
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl">
                <h3 className="text-sm font-semibold text-rose-800 flex items-center gap-2 mb-2">
                  <AlertTriangle size={16} /> Delete Account
                </h3>
                <p className="text-xs text-rose-700 leading-relaxed mb-4">
                  Once you delete your account, there is no going back. Please be certain. All your saved apps and data will be permanently deleted.
                </p>
                <button
                  onClick={handleDeleteAccount}
                  disabled={loading}
                  className="px-4 py-2 bg-surface border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Deleting...' : 'Delete My Account'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
