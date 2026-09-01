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

  const handleDeployClick = () => {
    onDeploy(password);
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
                Deployed {formatModifiedTime(deployment.deployedAt)} &middot; only people with the password can view it.
              </p>
            </div>
            {isSignedIn && (
              <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Password Protect</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock size={16} />
                  </div>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter a password"
                    className="w-full bg-surface border border-slate-300 rounded-lg pl-10 pr-4 py-3 text-sm text-slate-700 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-slate-400"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  A password is required to encrypt and deploy the app.
                </p>
              </div>
            )}
          </>
        ) : !isSignedIn ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <KeyRound size={18} className="text-slate-400 shrink-0 mt-0.5" />
            <span>Deploying needs an account, so your app can be stored and stay reachable at a stable link.</span>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
              <Globe size={18} className="text-slate-400 shrink-0 mt-0.5" />
              <span>
                We&rsquo;ll upload this app and give you a link you can share. Redeploying reuses the same link, so it always shows your latest version.
                <span className="block mt-1 text-slate-400">Only people with the password can view it.</span>
              </span>
            </div>
            <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Password Protect</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock size={16} />
                </div>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter a password"
                  className="w-full bg-surface border border-slate-300 rounded-lg pl-10 pr-4 py-3 text-sm text-slate-700 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-slate-400"
                />
              </div>
              <p className="text-xs text-slate-400">
                A password is required to encrypt and deploy the app.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3">
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
                disabled={isDeploying || password.trim().length === 0}
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
              disabled={isDeploying || !hasCode || password.trim().length === 0}
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
