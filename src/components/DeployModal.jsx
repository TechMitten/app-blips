import { useState } from 'react';
import {
  Rocket, Globe, KeyRound, TriangleAlert, Trash2, Copy, Check,
  ExternalLink, LogIn, Loader2, X, Lock
} from 'lucide-react';
import Modal from './Modal';
import { formatModifiedTime } from '../lib/helpers';

// Publish-to-public-URL modal: deploy / redeploy / remove / copy link. All
// state and handlers come from useDeployment via props; `onRequireSignIn`
// swaps this modal for the auth modal.
export default function DeployModal({
  isSignedIn,
  user,
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
  const [favicon, setFavicon] = useState(null);
  const [faviconError, setFaviconError] = useState('');

  const username = user?.user_metadata?.username;

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
      onDeploy(password, customSlug, preventIndexing, favicon);
    }
  };

  return (
    <Modal zIndex={70}>
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-base 2xl:text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Rocket size={18} className="text-brand" />
            {deployment ? 'Deployment' : 'Deploy your app'}
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {deployment ? 'Your app is live at this link.' : 'Publish this app to a public URL.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isDeploying}
          className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-6 space-y-4">
        {deployError && (
          <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl text-sm text-rose-700 flex items-start gap-3 animate-fade-in">
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
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
                <KeyRound size={18} className="text-slate-400 shrink-0 mt-0.5" />
                <span>Sign in to update or remove this deployment.</span>
              </div>
            )}
            {isSignedIn && isDeployStale && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
                <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <span>The live version is older than what&rsquo;s in your workspace. Redeploy to update the link.</span>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Public URL</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Globe size={16} />
                </div>
                <input
                  readOnly
                  value={deploymentUrl}
                  onFocus={(e) => e.target.select()}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-3 text-sm text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>
              <p className="text-xs text-slate-400">
                Deployed {formatModifiedTime(deployment.deployedAt)}.
              </p>
            </div>
            {isSignedIn && (
              <>
                <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Password Protect (optional)</label>
                <p className="text-xs text-slate-400 !mt-1">Set a password to redeploy this link as protected, or leave it blank for a public link.</p>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock size={16} />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter a password"
                    className="w-full bg-surface border border-slate-300 rounded-lg pl-10 pr-4 py-3 text-sm text-slate-700 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-slate-400"
                  />
                </div>
                <div className="relative group mt-2">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Check size={16} />
                  </div>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="w-full bg-surface border border-slate-300 rounded-lg pl-10 pr-4 py-3 text-sm text-slate-700 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-slate-400"
                  />
                </div>
                <p className={`text-xs ${password.length > 0 && !passwordValid ? 'text-rose-500 font-medium' : 'text-slate-400'}`}>
                  Password must be at least 8 characters with uppercase, lowercase, numbers, and symbol.
                </p>
                {password.length > 0 && confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="text-xs text-rose-500 font-medium">Passwords do not match.</p>
                )}
              </div>
              <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Search Engine Visibility</label>
                <div className="flex items-center justify-between gap-4 mt-2" onClick={() => setPreventIndexing(!preventIndexing)} style={{ cursor: 'pointer' }}>
                  <span className="text-sm text-slate-600 leading-tight">
                    Prevent search engines from indexing this app
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={preventIndexing}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                      preventIndexing
                        ? 'bg-brand border-transparent'
                        : 'bg-slate-200 border-slate-300 hover:bg-slate-300/70'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        preventIndexing ? 'translate-x-[23px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </button>
                </div>
              </div>
              <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Custom Favicon</label>
                <p className="text-xs text-slate-400 !mt-1">Upload an image file to use as the browser tab icon.</p>
                <div className="flex items-center gap-4 mt-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFaviconUpload}
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-brand/10 file:text-brand hover:file:bg-brand/20 transition-colors cursor-pointer"
                  />
                  {favicon && (
                    <img src={favicon} alt="Favicon preview" className="w-8 h-8 rounded border border-slate-200 object-cover shrink-0" />
                  )}
                </div>
                {faviconError && (
                  <p className="text-xs text-rose-500 font-medium">{faviconError}</p>
                )}
              </div>
              </>
            )}
          </>
        ) : !isSignedIn ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <KeyRound size={18} className="text-slate-400 shrink-0 mt-0.5" />
            <span>Deploying needs an account, so your app can be stored and stay reachable at a stable link.</span>
          </div>
        ) : !username ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <span>You must set a username in Account Settings before you can deploy apps.</span>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
              <Globe size={18} className="text-slate-400 shrink-0 mt-0.5" />
              <span>
                We&rsquo;ll upload this app and give you a link you can share. Redeploying reuses the same link, so it always shows your latest version.
              </span>
            </div>
            
            <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Custom URL Path</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 whitespace-nowrap">
                  {username} /
                </span>
                <input
                  type="text"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-app-name"
                  className="w-full bg-surface border border-slate-300 rounded-lg px-4 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-slate-400"
                />
              </div>
              <p className="text-xs text-slate-400">Leave blank to auto-generate a random path.</p>
            </div>
            <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Password Protect (optional)</label>
              <p className="text-xs text-slate-400 !mt-1">Leave blank for a public link, or set a password to require it before the app loads.</p>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock size={16} />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter a password"
                  className="w-full bg-surface border border-slate-300 rounded-lg pl-10 pr-4 py-3 text-sm text-slate-700 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-slate-400"
                />
              </div>
              <div className="relative group mt-2">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Check size={16} />
                </div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="w-full bg-surface border border-slate-300 rounded-lg pl-10 pr-4 py-3 text-sm text-slate-700 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-slate-400"
                />
              </div>
              <p className={`text-xs ${password.length > 0 && !passwordValid ? 'text-rose-500 font-medium' : 'text-slate-400'}`}>
                Password must be at least 8 characters with uppercase, lowercase, numbers, and symbol.
              </p>
              {password.length > 0 && confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-rose-500 font-medium">Passwords do not match.</p>
              )}
            </div>
            <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Search Engine Visibility</label>
              <div className="flex items-center justify-between gap-4 mt-2" onClick={() => setPreventIndexing(!preventIndexing)} style={{ cursor: 'pointer' }}>
                <span className="text-sm text-slate-600 leading-tight">
                  Prevent search engines from indexing this app
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preventIndexing}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                    preventIndexing
                      ? 'bg-brand border-transparent'
                      : 'bg-slate-200 border-slate-300 hover:bg-slate-300/70'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      preventIndexing ? 'translate-x-[23px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Custom Favicon</label>
              <p className="text-xs text-slate-400 !mt-1">Upload an image file to use as the browser tab icon.</p>
              <div className="flex items-center gap-4 mt-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFaviconUpload}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-brand/10 file:text-brand hover:file:bg-brand/20 transition-colors cursor-pointer"
                />
                {favicon && (
                  <img src={favicon} alt="Favicon preview" className="w-8 h-8 rounded border border-slate-200 object-cover shrink-0" />
                )}
              </div>
              {faviconError && (
                <p className="text-xs text-rose-500 font-medium">{faviconError}</p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="bg-slate-50 px-6 py-4 flex flex-wrap items-center justify-end gap-3">
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
            <button
              type="button"
              onClick={handleDeployClick}
              disabled={isDeploying || !hasCode || !canSubmitPassword || !username}
              className="whitespace-nowrap brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Rocket size={15} />
              Deploy
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
