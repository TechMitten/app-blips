import React, { useState } from 'react';
import { supabase } from '../supabase';
import { User, Mail, KeyRound, Trash2, X, AlertTriangle } from 'lucide-react';

export default function AccountSettingsModal({ user, onClose, onSignOut }) {
  const [activeTab, setActiveTab] = useState('profile'); // profile, security, danger
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
    const { error: updateError } = await supabase.auth.updateUser({
      password: password
    });
    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage('Password updated successfully.');
      setPassword('');
      setConfirmPassword('');
    }
    setLoading(false);
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Are you absolutely sure you want to delete your account? This action cannot be undone.')) {
      return;
    }
    setLoading(true);
    setError('');
    
    // We attempt a generic RPC call for deletion
    // Depending on backend this might fail if not configured, but provides the UI option
    const { error: deleteError } = await supabase.rpc('delete_user');
    
    if (deleteError) {
      // Fallback: Just sign out if delete isn't explicitly supported via RPC
      console.warn("Could not delete user via RPC:", deleteError);
      setError('Account deletion requires admin privileges or is not fully configured on the backend. ' + deleteError.message);
    } else {
      onSignOut();
      onClose();
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md xl:max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
              <User size={18} />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Account Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <X size={18} />
          </button>
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
                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
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
                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    placeholder="Confirm new password"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || !password}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className="px-4 py-2 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
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
