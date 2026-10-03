import { useState } from 'react';
import {
  Rocket, TriangleAlert, Trash2, Copy, CopyCheck, Check, SquareArrowOutUpRight,
  LogIn, LoaderCircle, X, Share2, ImageUp, Globe, LockKeyhole
} from 'lucide-react';
import Modal from './Modal';
import {
  SettingRow, Switch, TabList, FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON, TAB_PANEL_CLASS,
} from './SettingControls';
import { formatModifiedTime } from '../lib/helpers';
import { supabaseEnabled } from '../supabase';
import { APPS_ORIGIN } from '../lib/deploy';

const APPS_HOST = APPS_ORIGIN.replace(/^https?:\/\//, '');

// Same shell as SettingsModal: header bar, tab sidebar beside a panel of
// divided rows, footer bar with the actions on the right. The states without
// options (signed out, username, success) drop the sidebar and use the
// narrower card.
const CARD_BASE = 'w-full max-h-[90vh] bg-surface rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col';
const CARD_CLASS = `${CARD_BASE} max-w-lg xl:max-w-xl`;
const TABBED_CARD_CLASS = `${CARD_BASE} max-w-lg sm:max-w-2xl xl:max-w-3xl`;
// Footer buttons share the primary's px-5/py-2 box so the bar reads as one row.
const FOOTER_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const DANGER_BUTTON = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const DANGER_BUTTON_SOLID = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function ModalHeader({ title, onClose, disabled = false }) {
  return (
    <div className="shrink-0 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
      <h2 id="deploy-title" className="flex items-center gap-2.5 text-xl font-bold text-slate-900">
        <Rocket size={20} aria-hidden="true" className="shrink-0 text-slate-500" />
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        disabled={disabled}
        className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Close"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function ModalFooter({ children }) {
  return (
    <div className="shrink-0 bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-end gap-3">
      {children}
    </div>
  );
}

// Callout above the rows: amber for warnings, red for errors (same look as
// the Danger Zone notices in SettingsModal).
function Notice({ tone = 'warning', children }) {
  const look = tone === 'error'
    ? 'border-red-100 bg-red-50 text-red-500'
    : 'border-amber-200 bg-amber-50 text-amber-500';
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed flex items-start gap-3 ${look}`}>
      <TriangleAlert size={18} className="shrink-0 mt-0.5" />
      <span className="text-slate-600">{children}</span>
    </div>
  );
}

function Spinner({ label }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-sm text-slate-600">
      <LoaderCircle size={24} className="animate-spin text-slate-400" />
      <span>{label}</span>
    </div>
  );
}

// Publish-to-public-URL modal: deploy / redeploy / remove / copy link. All
// state and handlers come from useDeployment via props; `onRequireSignIn`
// swaps this modal for the auth modal. Deploy is a hosted-mode-only feature
// (Supabase Storage), so this renders a simple unavailable state instead when
// !supabaseEnabled -- self-hosted builds never reach the rest of this UI.
export default function DeployModal({
  isSignedIn,
  username,
  usernameLoading,
  onClaimUsername,
  deployment,
  studioMode = 'app',
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
  const noun = studioMode === 'website' ? 'website' : studioMode === 'game' ? 'game' : 'app';
  const Noun = noun === 'website' ? 'Website' : noun === 'game' ? 'Game' : 'App';
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
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  // True right after a successful deploy: shows the simplified "your app is
  // live" view. Dismissing it reveals the full redeploy options rather than
  // closing the modal.
  const [showSuccess, setShowSuccess] = useState(false);

  const passwordsMatch = password.length === 0 || (password === confirmPassword && password.length > 0);

  // With the toggle off the password is always blank (see togglePassword), so
  // a public deploy is trivially submittable. With it on, an empty password
  // would silently deploy an unprotected link -- block that instead.
  const canSubmitPassword =
    passwordsMatch && (!passwordEnabled || password.length > 0);

  const togglePassword = () => {
    setPasswordEnabled((on) => {
      if (on) { setPassword(''); setConfirmPassword(''); }
      return !on;
    });
  };

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

  const handleDeployClick = async () => {
    if (canSubmitPassword && (deployment || username)) {
      const ok = await onDeploy(password, customSlug, preventIndexing, favicon, analyticsEnabled);
      if (ok) setShowSuccess(true);
    }
  };

  // Uses the native share sheet where available (mobile, some desktop
  // browsers); otherwise falls back to copying the link.
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Check out my ${noun}`, url: deploymentUrl });
      } catch (err) {
        // AbortError just means the user dismissed the sheet.
        if (err?.name !== 'AbortError') onCopyUrl();
      }
    } else {
      onCopyUrl();
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


  // Always opens on General; not persisted like Settings' tab, since each
  // deploy is a fresh pass through the options.
  const [tab, setTab] = useState('general');

  const cardProps = { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'deploy-title' };

  if (!supabaseEnabled) {
    return (
      <Modal zIndex={70} cardClass={CARD_CLASS} cardProps={cardProps}>
        <ModalHeader title={`Deploy your ${noun}`} onClose={onClose} />
        <div className="px-6 py-5">
          <SettingRow
            title="Not available in single-user mode"
            description="Deploying to a public URL needs a configured Supabase project."
          />
        </div>
        <ModalFooter>
          <button type="button" onClick={onClose} className={PRIMARY_BUTTON}>
            Close
          </button>
        </ModalFooter>
      </Modal>
    );
  }

  const openDeployment = () => window.open(deploymentUrl, '_blank', 'noopener,noreferrer');

  const urlField = (
    <input
      readOnly
      value={deploymentUrl}
      aria-label={`${Noun} URL`}
      onFocus={(e) => e.target.select()}
      className={`${FIELD_CLASS} min-w-0 font-mono select-all`}
    />
  );

  const linkDetails = (
    <div className="flex flex-wrap sm:flex-nowrap gap-2">
      {urlField}
      <button type="button" onClick={onCopyUrl} className={`${SECONDARY_BUTTON} shrink-0`}>
        {deployCopied ? <CopyCheck size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {deployCopied ? 'Copied' : 'Copy'}
      </button>
      <button type="button" onClick={openDeployment} className={`${SECONDARY_BUTTON} shrink-0`}>
        <SquareArrowOutUpRight size={14} aria-hidden="true" />
        Open
      </button>
    </div>
  );

  if (showSuccess && deployment && !isDeploying) {
    const dismissSuccess = () => setShowSuccess(false);
    return (
      <Modal zIndex={70} cardClass={CARD_CLASS} cardProps={cardProps}>
        <ModalHeader title={`Your ${noun} is live`} onClose={dismissSuccess} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-5 space-y-5">
          <div className="divide-y divide-slate-200">
            <SettingRow
              id="deploy-link"
              title="Public link"
              description="Anyone with this link can use it."
              details={
                <div className="flex gap-2">
                  {urlField}
                  <button type="button" onClick={handleShare} className={`${SECONDARY_BUTTON} shrink-0`}>
                    {deployCopied ? <Check size={14} aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />}
                    {deployCopied ? 'Copied' : 'Share'}
                  </button>
                </div>
              }
            />
          </div>
        </div>
        <ModalFooter>
          <button type="button" onClick={dismissSuccess} className={FOOTER_BUTTON}>
            Done
          </button>
          <button type="button" onClick={openDeployment} className={PRIMARY_BUTTON}>
            <SquareArrowOutUpRight size={16} aria-hidden="true" />
            Open {noun}
          </button>
        </ModalFooter>
      </Modal>
    );
  }

  // The options only exist once the user can deploy: signed in, and either
  // managing an existing deployment or holding a username for a new one.
  const tabbed = Boolean(isSignedIn && (deployment || (!usernameLoading && username)));

  let footer;
  if (deployment && isSignedIn) {
    footer = (
      <>
        <button
          type="button"
          onClick={() => (confirmUndeploy ? onUndeploy() : setConfirmUndeploy(true))}
          disabled={isDeploying}
          className={`${confirmUndeploy ? DANGER_BUTTON_SOLID : DANGER_BUTTON} mr-auto`}
        >
          <Trash2 size={14} aria-hidden="true" />
          {confirmUndeploy ? 'Really remove?' : 'Remove'}
        </button>
        <button
          type="button"
          onClick={handleDeployClick}
          disabled={isDeploying || !canSubmitPassword}
          className={PRIMARY_BUTTON}
        >
          <Rocket size={16} aria-hidden="true" />
          Redeploy {Noun}
        </button>
      </>
    );
  } else if (!isSignedIn) {
    footer = (
      <>
        <button type="button" onClick={onClose} className={FOOTER_BUTTON}>
          {deployment ? 'Close' : 'Cancel'}
        </button>
        <button type="button" onClick={onRequireSignIn} className={PRIMARY_BUTTON}>
          <LogIn size={16} aria-hidden="true" />
          Sign in
        </button>
      </>
    );
  } else {
    footer = (
      <>
        <button type="button" onClick={onClose} disabled={isDeploying} className={FOOTER_BUTTON}>
          Cancel
        </button>
        {username && (
          <button
            type="button"
            onClick={handleDeployClick}
            disabled={isDeploying || !hasCode || !canSubmitPassword}
            className={PRIMARY_BUTTON}
          >
            <Rocket size={16} aria-hidden="true" />
            Deploy {Noun}
          </button>
        )}
      </>
    );
  }

  const title = deployment ? 'Manage deployment' : `Deploy your ${noun}`;

  if (!tabbed) {
    let body;
    if (deployment) {
      body = (
        <div className="divide-y divide-slate-200">
          <SettingRow
            title="Sign in to manage this deployment"
            description="You need to be signed in to update or remove it."
          />
          <SettingRow
            id="deploy-url"
            title="Public link"
            description={`Deployed ${formatModifiedTime(deployment.deployedAt)}.`}
            details={linkDetails}
          />
        </div>
      );
    } else if (!isSignedIn) {
      body = (
        <SettingRow
          title="Sign in to deploy"
          description={`Deploying needs an account, so your ${noun} can be stored and stay reachable at a stable link.`}
        />
      );
    } else if (usernameLoading) {
      body = <Spinner label="Checking your account..." />;
    } else {
      body = (
        <form onSubmit={handleClaimUsername}>
          <SettingRow
            id="deploy-username"
            title="Choose a username"
            description={`It becomes the first part of every ${noun} link you publish, and can't be changed once set.`}
            details={
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => { setUsernameInput(e.target.value); setUsernameError(''); }}
                    placeholder="Choose a username"
                    aria-labelledby="deploy-username"
                    autoFocus
                    className={`${FIELD_CLASS} min-w-0`}
                  />
                  <button
                    type="submit"
                    disabled={claimingUsername || !usernameInput.trim()}
                    className={`${PRIMARY_BUTTON} shrink-0`}
                  >
                    {claimingUsername ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}
                    {claimingUsername ? 'Setting...' : 'Set username'}
                  </button>
                </div>
                {usernameError && <p className="text-xs text-red-600 mt-2">{usernameError}</p>}
              </>
            }
          />
        </form>
      );
    }

    return (
      <Modal zIndex={70} cardClass={CARD_CLASS} cardProps={cardProps}>
        <ModalHeader title={title} onClose={onClose} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-5 space-y-5">
          {deployError && <Notice tone="error">{deployError}</Notice>}
          {body}
        </div>
        <ModalFooter>{footer}</ModalFooter>
      </Modal>
    );
  }

  // ---- Tabbed options -------------------------------------------------------

  const tabs = [
    { id: 'general', label: 'General', Icon: Globe },
    { id: 'privacy', label: 'Privacy', Icon: LockKeyhole, attention: passwordEnabled && !canSubmitPassword },
  ];

  const linkRow = deployment ? (
    <SettingRow
      id="deploy-url"
      title="Public link"
      description={`Deployed ${formatModifiedTime(deployment.deployedAt)}.`}
      details={linkDetails}
    />
  ) : (
    <SettingRow
      id="deploy-slug"
      title={`${Noun} URL`}
      description={`Choose a custom path, or leave it blank to generate one. Published at ${APPS_HOST}.`}
      details={
        <div className="flex items-stretch rounded-lg border border-slate-300 overflow-hidden focus-within:border-slate-500 transition-colors">
          <span className="flex items-center px-3 text-sm font-mono text-slate-500 bg-slate-50 border-r border-slate-300 whitespace-nowrap">
            {username}/
          </span>
          <input
            type="text"
            value={customSlug}
            onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="my-app-name"
            aria-labelledby="deploy-slug"
            className="w-full min-w-0 bg-transparent px-3 py-2 text-sm font-mono text-slate-900 placeholder:text-slate-400 outline-none"
          />
        </div>
      }
    />
  );

  const generalRows = (
    <>
      {linkRow}

      <SettingRow
        id="deploy-favicon"
        title={`${Noun} icon`}
        description="An image for the browser tab icon (favicon), up to 200KB."
        details={faviconError && <p className="text-xs text-red-600">{faviconError}</p>}
      >
        <div className="flex items-center gap-2.5">
          {favicon && (
            <img src={favicon} alt="Favicon preview" className="w-8 h-8 rounded-md border border-slate-200 object-cover" />
          )}
          <label className={`${SECONDARY_BUTTON} cursor-pointer`}>
            <ImageUp size={14} aria-hidden="true" />
            {favicon ? 'Change' : 'Upload'}
            <input type="file" accept="image/*" className="sr-only" onChange={handleFaviconUpload} aria-labelledby="deploy-favicon" />
          </label>
        </div>
      </SettingRow>

      <SettingRow
        id="deploy-analytics"
        title="Analytics"
        description="Track visits and usage with built-in analytics."
      >
        <Switch checked={analyticsEnabled} onChange={setAnalyticsEnabled} labelledBy="deploy-analytics" />
      </SettingRow>
    </>
  );

  const privacyRows = (
    <>
      <SettingRow
        id="deploy-password"
        title="Password protection"
        description={deployment
          ? `Require a password to open your ${noun}. Leave this off to redeploy as a public link.`
          : `Require a password to open your ${noun}.`}
        details={passwordEnabled && (
          <div className="space-y-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a password"
              aria-label="Password"
              className={FIELD_CLASS}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              aria-label="Confirm password"
              className={FIELD_CLASS}
            />
            {password.length > 0 && confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-red-600">Passwords do not match.</p>
            )}
          </div>
        )}
      >
        <Switch checked={passwordEnabled} onChange={togglePassword} labelledBy="deploy-password" />
      </SettingRow>

      <SettingRow
        id="deploy-noindex"
        title="Hide from search engines"
        description={`Ask search engines not to index your ${noun}.`}
      >
        <Switch checked={preventIndexing} onChange={setPreventIndexing} labelledBy="deploy-noindex" />
      </SettingRow>
    </>
  );

  return (
    <Modal zIndex={70} cardClass={TABBED_CARD_CLASS} cardProps={cardProps}>
      <ModalHeader title={title} onClose={onClose} disabled={isDeploying} />

      <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
        <TabList tabs={tabs} active={tab} onSelect={setTab} idPrefix="deploy" label="Deployment options" />

        <div
          role="tabpanel"
          id={`deploy-panel-${tab}`}
          aria-labelledby={`deploy-tab-${tab}`}
          tabIndex={0}
          className={`${TAB_PANEL_CLASS} space-y-5`}
        >
          {deployError && <Notice tone="error">{deployError}</Notice>}
          {isDeploying ? (
            <Spinner label={deployment && confirmUndeploy ? 'Removing deployment...' : `Uploading your ${noun}...`} />
          ) : (
            <>
              {tab === 'general' && deployment && isDeployStale && (
                <Notice>The live version is older than what&rsquo;s in your workspace. Redeploy to update the link.</Notice>
              )}
              <div className="divide-y divide-slate-200">
                {tab === 'general' && generalRows}
                {tab === 'privacy' && privacyRows}
              </div>
            </>
          )}
        </div>
      </div>

      <ModalFooter>{footer}</ModalFooter>
    </Modal>
  );
}
