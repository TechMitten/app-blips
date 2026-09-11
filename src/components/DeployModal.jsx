import { useState } from 'react';
import {
  Rocket, Globe, KeyRound, TriangleAlert, Trash2, Copy, Check,
  ExternalLink, LogIn, Loader2, X, Lock, Search, ImageIcon, User, BarChart3
} from 'lucide-react';
import Modal from './Modal';
import { formatModifiedTime } from '../lib/helpers';
import { firebaseEnabled } from '../firebase';

// Publish-to-public-URL modal: deploy / redeploy / remove / copy link. All
// state and handlers come from useDeployment via props; `onRequireSignIn`
// swaps this modal for the auth modal. Deploy is a hosted-mode-only feature
// (Firebase Storage), so this renders a simple unavailable state instead when
// !firebaseEnabled -- self-hosted builds never reach the rest of this UI.
export default function DeployModal({
  isSignedIn,
  username,
  usernameLoading,
  onClaimUsername,
  deployment,
  deploymentUrl,
  isDeployStale,
  isDeploying,
  deployError,
  deployCopied,
  confirmUndeploy,
  setConfirmUndeploy,
  hasCode,
  onClose,
  onDeploy,
  onUndeploy,
  onCopyUrl,
  onRequireSignIn,
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [customSlug, setCustomSlug] = useState('');
  const [preventIndexing, setPreventIndexing] = useState(false);
  // Deliberate exception to every other toggle in this file: preventIndexing/
  // password/favicon all reset to their defaults each time the modal opens --
  // that's fine for a password you must re-enter, but wrong for analytics,
  // since toggling it off and back on should reuse the same Umami website
  // (and its history), not silently lose the association. A lazy initializer
  // is enough (rather than a useEffect) because DeployModal fully unmounts on
  // close -- see its `{isDeployModalOpen && <DeployModal ... />}` guard in
  // App.jsx -- so this re-runs every time the modal opens.
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() => Boolean(deployment?.analyticsEnabled));
  const [favicon, setFavicon] = useState(null);
  const [faviconError, setFaviconError] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [claimingUsername, setClaimingUsername] = useState(false);

  const passwordValid =
    password.length === 0 ||
    (password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password));

  const passwordsMatch = password.length === 0 || (password === confirmPassword && password.length > 0);

  const canSubmitPassword = passwordValid && passwordsMatch;

  const handleFaviconUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 200 * 1024) {
      setFaviconError('Favicon must be smaller than 200KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setFavicon(reader.result);
      setFaviconError('');
    };
    reader.onerror = () => setFaviconError('Failed to read the file.');
    reader.readAsDataURL(file);
  };

  const handleDeployClick = () => {
    if (canSubmitPassword && (deployment || username)) {
      onDeploy(password, customSlug, preventIndexing, favicon, analyticsEnabled);
    }
  };

  const handleClaimUsername = async (e) => {
    e.preventDefault();
    setClaimingUsername(true);
    setUsernameError('');
    try {
      await onClaimUsername(usernameInput);
    } catch (err) {
      setUsernameError(err.message || 'Failed to set username.');
    }
    setClaimingUsername(false);
  };

  if (!firebaseEnabled) {
    return (
      <Modal zIndex={70}>
        <div className="px-6 py-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <h2 className="text-base 2xl:text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Rocket size={18} className="text-brand" />
            Deploy your app
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6">
          <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <Globe size={18} className="text-slate-400 shrink-0 mt-0.5" />
            <span>Deploy is not available in self-hosted mode.</span>
          </div>
        </div>
        <div className="bg-slate-50 border-t border-slate-200 dark:border-white/10 px-6 py-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="whitespace-nowrap rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal zIndex={70}>
      <div className="px-6 py-4.5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
        <div>
          <h2 className="text-base 2xl:text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Rocket size={18} className="text-brand" />
            {deployment ? 'Deployment' : 'Deploy your app'}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {deployment ? 'Your app is live at this link.' : 'Publish this app to a public URL.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isDeploying}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-6 space-y-4">
        {deployError && (
          <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-xl text-sm text-rose-700 flex items-start gap-3 animate-fade-in">
            <TriangleAlert size={18} className="text-rose-500 shrink-0 mt-0.5" />
            <span>{deployError}</span>
          </div>
        )}

        {isDeploying ? (
          <div className="flex items-center gap-3 px-4 py-6 text-sm text-slate-600">
            <Loader2 size={18} className="animate-spin text-brand" />
            <span>{deployment && confirmUndeploy ? 'Removing deployment...' : 'Uploading your app...'}</span>
          </div>
        ) : deployment ? (
          <>
            {!isSignedIn && (
              <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
                <KeyRound size={18} className="text-slate-400 shrink-0 mt-0.5" />
                <span>Sign in to update or remove this deployment.</span>
              </div>
            )}
            {isSignedIn && isDeployStale && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 leading-relaxed flex items-start gap-3">
                <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <span>The live version is older than what&rsquo;s in your workspace. Redeploy to update the link.</span>
              </div>
            )}

            {/* Section 1: Public URL */}
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <Globe size={12} />
                </div>
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Public URL
                </label>
              </div>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Globe size={16} />
                </div>
                <input
                  readOnly
                  value={deploymentUrl}
                  onFocus={(e) => e.target.select()}
                  className="w-full bg-slate-50 border border-slate-200 dark:border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm font-mono text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all select-all shadow-2xs"
                />
              </div>
              <p className="text-xs text-slate-400">
                Deployed {formatModifiedTime(deployment.deployedAt)}.
              </p>
            </section>

            {isSignedIn && (
              <>
                {/* Section 2: Password Protect */}
                <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        <Lock size={12} />
                      </div>
                      <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Password Protect <span className="font-normal text-slate-500 lowercase text-[11px]">(optional)</span>
                      </label>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Set a password to redeploy this link as protected, or leave it blank for a public link.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <Lock size={16} />
                      </div>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter a password"
                        className="w-full bg-surface border border-slate-300 dark:border-white/15 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:border-slate-400 dark:hover:border-white/25 shadow-2xs"
                      />
                    </div>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <Check size={16} />
                      </div>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm password"
                        className="w-full bg-surface border border-slate-300 dark:border-white/15 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:border-slate-400 dark:hover:border-white/25 shadow-2xs"
                      />
                    </div>
                  </div>

                  <p className={`text-xs ${password.length > 0 && !passwordValid ? 'text-rose-500 font-medium' : 'text-slate-400'}`}>
                    Password must be at least 8 characters with uppercase, lowercase, numbers, and symbol.
                  </p>
                  {password.length > 0 && confirmPassword.length > 0 && !passwordsMatch && (
                    <p className="text-xs text-rose-500 font-medium">Passwords do not match.</p>
                  )}
                </section>
            {/* Section 4: Search Engine Visibility */}
                <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      <Search size={12} />
                    </div>
                    <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Search Engine Visibility
                    </label>
                  </div>
                  <div
                    onClick={() => setPreventIndexing(!preventIndexing)}
                    className="flex items-center justify-between gap-4 mt-1 cursor-pointer"
                  >
                    <span className="text-sm text-slate-700 leading-tight">
                      Prevent search engines from indexing this app
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={preventIndexing}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                        preventIndexing
                          ? 'bg-brand border-transparent'
                          : 'bg-slate-200 border-slate-300 hover:bg-slate-300/70 dark:bg-slate-700 dark:border-slate-600 dark:hover:bg-slate-600/70'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          preventIndexing ? 'translate-x-[23px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </div>
                </section>

                {/* Section 3b: Analytics */}
                <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        <BarChart3 size={12} />
                      </div>
                      <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Analytics
                      </label>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Track visits to this app using your self-hosted analytics.
                    </p>
                  </div>
                  <div
                    onClick={() => setAnalyticsEnabled(!analyticsEnabled)}
                    className="flex items-center justify-between gap-4 mt-1 cursor-pointer"
                  >
                    <span className="text-sm text-slate-700 leading-tight">
                      Enable analytics for this app
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={analyticsEnabled}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                        analyticsEnabled
                          ? 'bg-brand border-transparent'
                          : 'bg-slate-200 border-slate-300 hover:bg-slate-300/70 dark:bg-slate-700 dark:border-slate-600 dark:hover:bg-slate-600/70'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          analyticsEnabled ? 'translate-x-[23px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </div>
                </section>

                {/* Section 4: Custom Favicon */}
                <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        <ImageIcon size={12} />
                      </div>
                      <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Custom Favicon
                      </label>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Upload an image file to use as the browser tab icon.
                    </p>
                  </div>
                  <div className="flex items-center gap-4 mt-1.5">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFaviconUpload}
                      className="block w-full text-sm text-slate-500 file:mr-4 file:py-1.5 file:px-3.5 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-brand/10 file:text-brand hover:file:bg-brand/20 transition-colors cursor-pointer"
                    />
                    {favicon && (
                      <img src={favicon} alt="Favicon preview" className="w-8 h-8 rounded border border-slate-200 dark:border-white/10 object-cover shrink-0" />
                    )}
                  </div>
                  {faviconError && (
                    <p className="text-xs text-rose-500 font-medium">{faviconError}</p>
                  )}
                </section>
              </>
            )}
          </>
        ) : !isSignedIn ? (
          <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <KeyRound size={18} className="text-slate-400 shrink-0 mt-0.5" />
            <span>Deploying needs an account, so your app can be stored and stay reachable at a stable link.</span>
          </div>
        ) : usernameLoading ? (
          <div className="flex items-center gap-3 px-4 py-6 text-sm text-slate-600">
            <Loader2 size={18} className="animate-spin text-brand" />
            <span>Checking your account...</span>
          </div>
        ) : !username ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 leading-relaxed flex items-start gap-3">
              <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <span>Choose a username first. It&rsquo;s used in your app&rsquo;s URL and can&rsquo;t be changed once set.</span>
            </div>
            <form onSubmit={handleClaimUsername} className="space-y-2">
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User size={16} />
                </div>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => { setUsernameInput(e.target.value); setUsernameError(''); }}
                  placeholder="Choose a username"
                  autoFocus
                  className="w-full bg-surface border border-slate-300 dark:border-white/15 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:border-slate-400 dark:hover:border-white/25 shadow-2xs"
                />
              </div>
              {usernameError && (
                <p className="text-xs text-rose-500 font-medium">{usernameError}</p>
              )}
              <button
                type="submit"
                disabled={claimingUsername || !usernameInput.trim()}
                className="brand-fill-text w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {claimingUsername ? <Loader2 size={15} className="animate-spin" /> : <User size={15} />}
                {claimingUsername ? 'Setting username...' : 'Set username'}
              </button>
            </form>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
              <Globe size={18} className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <span>
                We&rsquo;ll upload this app and give you a link you can share. Redeploying reuses the same link, so it always shows your latest version.
              </span>
            </div>

            {/* Section 1: Custom URL Path */}
            <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <Globe size={12} />
                  </div>
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Custom URL Path
                  </label>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Leave blank to auto-generate a random path.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 whitespace-nowrap font-mono">
                  {username} /
                </span>
                <input
                  type="text"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-app-name"
                  className="w-full bg-surface border border-slate-300 dark:border-white/15 rounded-lg px-4 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:border-slate-400 dark:hover:border-white/25 shadow-2xs"
                />
              </div>
            </section>

            {/* Section 2: Password Protect */}
            <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <Lock size={12} />
                  </div>
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Password Protect <span className="font-normal text-slate-500 lowercase text-[11px]">(optional)</span>
                  </label>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Leave blank for a public link, or set a password to require it before the app loads.</p>
              </div>

              <div className="space-y-2">
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock size={16} />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter a password"
                    className="w-full bg-surface border border-slate-300 dark:border-white/15 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:border-slate-400 dark:hover:border-white/25 shadow-2xs"
                  />
                </div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Check size={16} />
                  </div>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="w-full bg-surface border border-slate-300 dark:border-white/15 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none transition-all hover:border-slate-400 dark:hover:border-white/25 shadow-2xs"
                  />
                </div>
              </div>

              <p className={`text-xs ${password.length > 0 && !passwordValid ? 'text-rose-500 font-medium' : 'text-slate-400'}`}>
                Password must be at least 8 characters with uppercase, lowercase, numbers, and symbol.
              </p>
              {password.length > 0 && confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-rose-500 font-medium">Passwords do not match.</p>
              )}
            </section>
            {/* Section 4: Search Engine Visibility */}
            <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <Search size={12} />
                </div>
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Search Engine Visibility
                </label>
              </div>
              <div
                onClick={() => setPreventIndexing(!preventIndexing)}
                className="flex items-center justify-between gap-4 mt-1 cursor-pointer"
              >
                <span className="text-sm text-slate-700 leading-tight">
                  Prevent search engines from indexing this app
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preventIndexing}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                    preventIndexing
                      ? 'bg-brand border-transparent'
                      : 'bg-slate-200 border-slate-300 hover:bg-slate-300/70 dark:bg-slate-700 dark:border-slate-600 dark:hover:bg-slate-600/70'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      preventIndexing ? 'translate-x-[23px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </div>
            </section>

            {/* Section 3b: Analytics */}
            <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <BarChart3 size={12} />
                  </div>
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Analytics
                  </label>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Track visits to this app using your self-hosted analytics.
                </p>
              </div>
              <div
                onClick={() => setAnalyticsEnabled(!analyticsEnabled)}
                className="flex items-center justify-between gap-4 mt-1 cursor-pointer"
              >
                <span className="text-sm text-slate-700 leading-tight">
                  Enable analytics for this app
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={analyticsEnabled}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                    analyticsEnabled
                      ? 'bg-brand border-transparent'
                      : 'bg-slate-200 border-slate-300 hover:bg-slate-300/70 dark:bg-slate-700 dark:border-slate-600 dark:hover:bg-slate-600/70'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      analyticsEnabled ? 'translate-x-[23px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </div>
            </section>

            {/* Section 4: Custom Favicon */}
            <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <ImageIcon size={12} />
                  </div>
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Custom Favicon
                  </label>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Upload an image file to use as the browser tab icon.
                </p>
              </div>
              <div className="flex items-center gap-4 mt-1.5">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFaviconUpload}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-1.5 file:px-3.5 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-brand/10 file:text-brand hover:file:bg-brand/20 transition-colors cursor-pointer"
                />
                {favicon && (
                  <img src={favicon} alt="Favicon preview" className="w-8 h-8 rounded border border-slate-200 dark:border-white/10 object-cover shrink-0" />
                )}
              </div>
              {faviconError && (
                <p className="text-xs text-rose-500 font-medium">{faviconError}</p>
              )}
            </section>
          </>
        )}
      </div>

      <div className="bg-slate-50 border-t border-slate-200 dark:border-white/10 px-6 py-4 flex flex-wrap items-center justify-end gap-3">
        {deployment ? (
          <>
            {isSignedIn && (
              <button
                type="button"
                onClick={() => (confirmUndeploy ? onUndeploy() : setConfirmUndeploy(true))}
                disabled={isDeploying}
                className={`whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmUndeploy
                  ? 'text-rose-600 bg-rose-50 hover:bg-rose-100'
                  : 'text-slate-600 hover:text-rose-600'
                  }`}
              >
                <Trash2 size={15} />
                {confirmUndeploy ? 'Really remove?' : 'Remove'}
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onCopyUrl}
              className="whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              {deployCopied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
              {deployCopied ? 'Copied' : 'Copy link'}
            </button>
            <button
              type="button"
              onClick={() => window.open(deploymentUrl, '_blank', 'noopener,noreferrer')}
              className="whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              <ExternalLink size={15} />
              Open
            </button>
            {isSignedIn ? (
              <button
                type="button"
                onClick={handleDeployClick}
                disabled={isDeploying || !canSubmitPassword}
                className="whitespace-nowrap brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Rocket size={15} />
                Redeploy
              </button>
            ) : (
              <button
                type="button"
                onClick={onRequireSignIn}
                className="whitespace-nowrap brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
              >
                <LogIn size={15} />
                Sign in
              </button>
            )}
          </>
        ) : !isSignedIn ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="whitespace-nowrap rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onRequireSignIn}
              className="whitespace-nowrap brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
            >
              <LogIn size={15} />
              Sign in
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={isDeploying}
              className="whitespace-nowrap rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            {username && (
              <button
                type="button"
                onClick={handleDeployClick}
                disabled={isDeploying || !hasCode || !canSubmitPassword}
                className="whitespace-nowrap brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Rocket size={15} />
                Deploy
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
