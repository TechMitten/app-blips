import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Sparkles,
  Mail,
  Lock,
  Loader2,
  LogIn,
  UserPlus,
  ArrowLeft,
  Send,
  ShieldAlert
} from 'lucide-react';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (loginError) {
      setError(loginError.message);
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    const { error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin
      }
    });

    if (signupError) {
      setError(signupError.message);
      setLoading(false);
    } else {
      setMessage('Check your email for the confirmation link.');
      setMode('verify');
      setLoading(false);
    }
  };

  const handleResendEmail = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);

    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: window.location.origin
      }
    });

    if (resendError) {
      setError(resendError.message);
    } else {
      setMessage('Confirmation email resent. Check your inbox.');
    }
    setLoading(false);
  };

  const switchMode = (newMode) => {
    setError(null);
    setMessage(null);
    setMode(newMode);
  };

  if (mode === 'verify') {
    return (
      <div className="min-h-screen h-dvh bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
          <div className="px-8 py-12 flex flex-col items-center text-center">
            <div className="bg-indigo-50 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
              <Mail size={28} className="text-indigo-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Check your email</h2>
            <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
              We sent a confirmation link to <span className="font-semibold text-slate-700">{email}</span>. Click the link to activate your account.
            </p>

            {message && (
              <div className="mt-5 w-full bg-emerald-50 border border-emerald-100 px-4 py-3 rounded-xl">
                <p className="text-sm text-emerald-700 font-medium">{message}</p>
              </div>
            )}

            {error && (
              <div className="mt-5 w-full bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
                <p className="text-sm text-red-700 font-medium">{error}</p>
              </div>
            )}

            <div className="mt-8 space-y-3 w-full">
              <button
                onClick={handleResendEmail}
                disabled={loading}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-all active:scale-[0.98] ${
                  loading
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                }`}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Resend email
              </button>
              <button
                onClick={() => switchMode('login')}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft size={16} />
                Back to sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen h-dvh bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in">
        <div className="px-8 pt-8 pb-5 flex flex-col items-center">
          <div className="bg-indigo-600 p-3 rounded-xl text-white shadow-sm shadow-indigo-200 mb-5">
            <Sparkles size={24} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="text-slate-400 text-sm">
            {mode === 'login' ? 'Sign in to continue to Orion' : 'Start building apps with Orion'}
          </p>
        </div>

        <form
          onSubmit={mode === 'login' ? handleLogin : handleSignup}
          className="px-8 pb-8 space-y-5"
        >
          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Email
            </label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                <Mail size={16} />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                placeholder="you@example.com"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Password
            </label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                <Lock size={16} />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                placeholder="Enter your password"
                required
                minLength={6}
                disabled={loading}
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 p-4 rounded-xl flex items-start gap-3">
              <ShieldAlert size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium leading-snug">{error}</p>
            </div>
          )}

          <div className="pt-2 space-y-3">
            <button
              type="submit"
              disabled={loading || !email.trim() || !password.trim()}
              className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold transition-all active:scale-[0.98] ${
                loading || !email.trim() || !password.trim()
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
              }`}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : mode === 'login' ? (
                <LogIn size={16} />
              ) : (
                <UserPlus size={16} />
              )}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>

            <p className="text-center text-sm text-slate-400">
              {mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    className="text-indigo-600 font-semibold hover:text-indigo-700 transition-colors"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="text-indigo-600 font-semibold hover:text-indigo-700 transition-colors"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
