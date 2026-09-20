import { useState } from 'react';
import {
  Rocket, Globe, KeyRound, TriangleAlert, Trash2, Copy, Check,
  ExternalLink, LogIn, Loader2, X, Lock, Search, ImageIcon, User, BarChart3,
  Link2, ShieldCheck, ArrowRight, Share2
} from 'lucide-react';
import Modal from './Modal';
import { formatModifiedTime } from '../lib/helpers';
import { firebaseEnabled } from '../firebase';
import { APPS_ORIGIN } from '../lib/deploy';

const APPS_HOST = APPS_ORIGIN.replace(/^https?:\/\//, '');

// Tinted icon tiles. Decorative accents only -- they keep their hue in both
// themes (same approach as StarterIdeas). Seven distinct hues, one per tile
// in the modal, so no two rows (however far apart) ever read as "the same
// icon" -- a plain gray/slate tile also disappears against this modal's dark,
// low-contrast card chrome, so every tile gets a real, saturated hue.
const TILE_TINTS = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  teal: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400',
};

function Tile({ icon: Icon, tint = 'blue', size = 'md' }) {
  const box = size === 'lg' ? 'w-12 h-12 rounded-2xl' : 'w-11 h-11 rounded-xl';
  return (
    <div className={`${box} ${TILE_TINTS[tint]} flex items-center justify-center shrink-0`}>
      {Icon && <Icon size={size === 'lg' ? 24 : 20} />}
    </div>
  );
}

function Switch({ checked }) {
  // On-state deliberately does NOT use bg-brand: --color-brand flips to white
  // in dark theme (every primary button relies on that to invert), which
  // would render an "enabled" switch as a solid white pill. emerald-500 is
  // the same on-color every other toggle in the app uses (SettingsModal),
  // and it isn't part of the brand-inversion story so it stays green in both
  // themes.
  return (
    <span
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
        checked
          ? 'bg-emerald-500 border-transparent'
          : 'bg-slate-200 border-slate-300 dark:bg-slate-700 dark:border-slate-600'
      }`}
    >
      <span
        // Positioned by `left` against the track's own width instead of a
        // fixed translate-x, so the on-state thumb always lands flush with
        // the right edge regardless of how the track's box resolves.
        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full shadow-sm transition-[left] duration-200 ${
          checked ? 'left-[calc(100%-1.1875rem)] bg-white' : 'left-[3px] bg-white dark:bg-slate-300'
        }`}
      />
    </span>
  );
}

// One settings row: tinted tile, title (+ optional pill), description, and
// either a trailing control (`action`) or a full-width one below (`children`).
function OptionCard({ icon, tint, title, pill, description, action, children, onClick, checked }) {
  const interactive = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      role={interactive ? 'switch' : undefined}
      aria-checked={interactive ? checked : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      } : undefined}
      className={`rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03] p-4 transition-colors ${
        interactive ? 'cursor-pointer hover:border-slate-300 dark:hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-brand/40' : ''
      }`}
    >
      <div className="flex items-start gap-3.5">
        <Tile icon={icon} tint={tint} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900 leading-tight">{title}</h3>
            {pill && (
              <span className="rounded-full border border-slate-300 dark:border-white/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {pill}
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-slate-500 leading-relaxed mt-1">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children && <div className="mt-3.5">{children}</div>}
    </div>
  );
}

const FIELD_CLASS =
  'w-full bg-surface border border-slate-300 dark:border-white/15 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition-all hover:border-slate-400 dark:hover:border-white/25';

// The modal's main CTA (Deploy/Redeploy/Sign in). Deliberately hardcoded blue
// rather than the app's usual `bg-brand`/`brand-fill-text` treatment: --color-brand
// flips to white in dark theme (see the Switch comment above) and
// .brand-fill-text exists specifically to chase that with a white gradient +
// dark text, which doesn't match the vivid blue button this modal is
// designed around. bg-blue-600 is still a themed token (it's re-pinned for
// dark mode in index.css), so it shifts appropriately between themes without
// ever turning white -- this is a one-off for this modal's CTA, not a
// pattern to copy elsewhere.
//
// The trailing arrow is absolutely positioned rather than laid out inline
// with `ml-auto`: an `ml-auto` sibling consumes all remaining flex space
// itself, which left-aligns the icon+label pair instead of letting
// `justify-center` center it. Taking the arrow out of flow lets the label
// center properly while the arrow still pins to the right edge.
function PrimaryButton({ icon, arrow = true, size = 'lg', className = '', children, ...rest }) {
  const sizeClass = size === 'sm' ? 'text-sm py-3' : 'text-base py-3.5';
  return (
    <button
      type="button"
      {...rest}
      className={`relative w-full inline-flex items-center justify-center gap-2.5 rounded-2xl px-5 ${sizeClass} font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${className}`}
    >
      <span className="inline-flex items-center gap-2.5">
        {icon}
        {children}
      </span>
      {arrow && <ArrowRight size={20} className="absolute right-5 top-1/2 -translate-y-1/2" />}
    </button>
  );
}

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
  const noun = studioMode === 'website' ? 'website' : 'app';
  const Noun = noun === 'website' ? 'Website' : 'App';
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

  const header = (
    <div className="shrink-0 px-6 pt-6 pb-5 flex items-start gap-4">
      <Tile icon={Rocket} tint="blue" size="lg" />
      <div className="min-w-0 flex-1">
        <h2 className="text-xl 2xl:text-2xl font-bold text-slate-900 leading-tight">
          {deployment ? 'Deployment' : `Deploy your ${noun}`}
        </h2>
        <p className="text-sm text-slate-500 mt-1 leading-snug">
          {deployment ? `Your ${noun} is live at this link.` : `Publish your ${noun} to a public URL in seconds.`}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={isDeploying}
        className="shrink-0 rounded-xl p-2 bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Close"
      >
        <X size={18} />
      </button>
    </div>
  );

  if (!firebaseEnabled) {
    return (
      <Modal zIndex={70} cardClass="w-full max-w-md xl:max-w-lg bg-surface rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden animate-scale-in">
        {header}
        <div className="px-6 pb-6">
          <OptionCard
            icon={Globe}
            tint="blue"
            title="Not available in self-hosted mode"
            description="Deploying to a public URL needs the hosted build."
          />
        </div>
        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl px-4 py-3 font-semibold text-sm text-slate-600 hover:text-slate-900 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
          >
            Close
          </button>
        </div>
      </Modal>
    );
  }

  // Shared option cards -- identical between the first-deploy and redeploy
  // flows, so they're built once here rather than duplicated in both branches.
  const optionCards = (
    <>
      <OptionCard
        icon={Lock}
        tint="violet"
        title="Password protection"
        pill="Optional"
        description={deployment
          ? `Require a password to access your ${noun}. Leave this off to redeploy as a public link.`
          : `Require a password to access your ${noun}.`}
        onClick={togglePassword}
        checked={passwordEnabled}
        action={<Switch checked={passwordEnabled} />}
      >
        {passwordEnabled && (
          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a password"
              autoFocus
              className={FIELD_CLASS}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              className={FIELD_CLASS}
            />
            {password.length > 0 && confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-rose-500 font-medium">Passwords do not match.</p>
            )}
          </div>
        )}
      </OptionCard>

      <OptionCard
        icon={Search}
        tint="rose"
        title="Search engine visibility"
        description={`Prevent search engines from indexing your ${noun}.`}
        onClick={() => setPreventIndexing(!preventIndexing)}
        checked={preventIndexing}
        action={<Switch checked={preventIndexing} />}
      />

      <OptionCard
        icon={BarChart3}
        tint="emerald"
        title="Analytics"
        description="Track visits and usage with built-in analytics."
        onClick={() => setAnalyticsEnabled(!analyticsEnabled)}
        checked={analyticsEnabled}
        action={<Switch checked={analyticsEnabled} />}
      />

      <OptionCard
        icon={ImageIcon}
        tint="sky"
        title={`${Noun} icon (favicon)`}
        description="Upload an image to use as your browser tab icon."
      >
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="image/*"
            onChange={handleFaviconUpload}
            className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-200/70 dark:file:bg-white/10 file:text-slate-800 hover:file:bg-slate-300/70 dark:hover:file:bg-white/15 transition-colors cursor-pointer"
          />
          {favicon && (
            <img src={favicon} alt="Favicon preview" className="w-9 h-9 rounded-lg border border-slate-200 dark:border-white/10 object-cover shrink-0" />
          )}
        </div>
        {faviconError && <p className="text-xs text-rose-500 font-medium mt-2">{faviconError}</p>}
      </OptionCard>
    </>
  );

  const secondaryButtonClass =
    'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  if (showSuccess && deployment && !isDeploying) {
    const dismissSuccess = () => setShowSuccess(false);
    return (
      <Modal
        zIndex={70}
        cardClass="relative w-full max-w-md xl:max-w-lg bg-surface rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden animate-scale-in"
      >
        <button
          type="button"
          onClick={dismissSuccess}
          className="absolute top-4 right-4 rounded-xl p-2 bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <div className="px-6 pt-6 pb-2 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400 flex items-center justify-center">
            <Check size={28} />
          </div>
          <h2 className="text-xl 2xl:text-2xl font-bold text-slate-900 leading-tight mt-4">Your {noun} is live!</h2>
          <p className="text-sm text-slate-500 mt-1 leading-snug">Anyone with this link can use it.</p>
        </div>

        <div className="px-6 pt-4 space-y-3">
          <input
            readOnly
            value={deploymentUrl}
            aria-label={`${Noun} URL`}
            onFocus={(e) => e.target.select()}
            className="w-full bg-surface border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 text-center focus:ring-2 focus:ring-brand/40 outline-none transition-all select-all"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.open(deploymentUrl, '_blank', 'noopener,noreferrer')}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors active:scale-[0.99]"
            >
              <ExternalLink size={16} />
              Open {noun}
            </button>
            <button
              type="button"
              onClick={handleShare}
              className={`${secondaryButtonClass} flex-1 py-3`}
            >
              {deployCopied ? <Check size={16} className="text-emerald-500" /> : <Share2 size={16} />}
              {deployCopied ? 'Link copied' : 'Share'}
            </button>
          </div>
        </div>

        <div className="px-6 pt-3 pb-6">
          <button
            type="button"
            onClick={dismissSuccess}
            className="w-full rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      zIndex={70}
      cardClass="w-full max-w-md xl:max-w-lg 2xl:max-w-xl max-h-[92vh] bg-surface rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden animate-scale-in flex flex-col"
    >
      {header}

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pb-2 space-y-3">
        {deployError && (
          <div className="rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 flex items-start gap-3 animate-fade-in">
            <TriangleAlert size={18} className="text-rose-500 shrink-0 mt-0.5" />
            <span>{deployError}</span>
          </div>
        )}

        {isDeploying ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-sm text-slate-600">
            <Loader2 size={28} className="animate-spin text-brand" />
            <span>{deployment && confirmUndeploy ? 'Removing deployment...' : `Uploading your ${noun}...`}</span>
          </div>
        ) : deployment ? (
          <>
            {!isSignedIn && (
              <OptionCard
                icon={KeyRound}
                tint="blue"
                title="Sign in to manage this deployment"
                description="You need to be signed in to update or remove it."
              />
            )}
            {isSignedIn && isDeployStale && (
              <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 flex items-start gap-3">
                <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <span>The live version is older than what&rsquo;s in your workspace. Redeploy to update the link.</span>
              </div>
            )}

            <OptionCard
              icon={Globe}
              tint="teal"
              title="Public URL"
              description={`Deployed ${formatModifiedTime(deployment.deployedAt)}.`}
            >
              <input
                readOnly
                value={deploymentUrl}
                onFocus={(e) => e.target.select()}
                className="w-full bg-surface border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-800 focus:ring-2 focus:ring-brand/40 outline-none transition-all select-all"
              />
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCopyUrl}
                  className={`${secondaryButtonClass} flex-1`}
                >
                  {deployCopied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
                  {deployCopied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => window.open(deploymentUrl, '_blank', 'noopener,noreferrer')}
                  className={`${secondaryButtonClass} flex-1`}
                >
                  <ExternalLink size={15} />
                  Open
                </button>
              </div>
            </OptionCard>

            {isSignedIn && optionCards}
          </>
        ) : !isSignedIn ? (
          <OptionCard
            icon={KeyRound}
            tint="blue"
            title="Sign in to deploy"
            description={`Deploying needs an account, so your ${noun} can be stored and stay reachable at a stable link.`}
          />
        ) : usernameLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-sm text-slate-600">
            <Loader2 size={28} className="animate-spin text-brand" />
            <span>Checking your account...</span>
          </div>
        ) : !username ? (
          <>
            <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 flex items-start gap-3">
              <TriangleAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <span>Choose a username first. It&rsquo;s used in your {noun}&rsquo;s URL and can&rsquo;t be changed once set.</span>
            </div>
            <form onSubmit={handleClaimUsername}>
              <OptionCard
                icon={User}
                tint="blue"
                title="Username"
                description={`This becomes the first segment of every ${noun} link you publish.`}
              >
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => { setUsernameInput(e.target.value); setUsernameError(''); }}
                  placeholder="Choose a username"
                  autoFocus
                  className={FIELD_CLASS}
                />
                {usernameError && <p className="text-xs text-rose-500 font-medium mt-2">{usernameError}</p>}
                <PrimaryButton
                  type="submit"
                  size="sm"
                  arrow={false}
                  disabled={claimingUsername || !usernameInput.trim()}
                  className="mt-3"
                  icon={claimingUsername ? <Loader2 size={16} className="animate-spin" /> : <User size={16} />}
                >
                  {claimingUsername ? 'Setting username...' : 'Set username'}
                </PrimaryButton>
              </OptionCard>
            </form>
          </>
        ) : (
          <>
            <div className="rounded-2xl border border-brand/30 bg-brand/[0.06] dark:bg-white/[0.06] p-4 flex items-start gap-3.5">
              <Tile icon={Globe} tint="amber" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 leading-tight">
                  We&rsquo;ll deploy your {noun} and give you a link
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed mt-1">
                  Re-deploy anytime and your link always points to the latest version.
                </p>
              </div>
            </div>

            <OptionCard
              icon={Link2}
              tint="teal"
              title={`${Noun} URL`}
              description="Choose a custom path (optional)."
            >
              <div className="flex items-stretch rounded-xl border border-slate-300 dark:border-white/15 bg-surface overflow-hidden focus-within:ring-2 focus-within:ring-brand/40 focus-within:border-brand transition-all">
                <span className="flex items-center px-3.5 text-sm font-mono text-slate-400 bg-slate-50 dark:bg-white/5 border-r border-slate-300 dark:border-white/15 whitespace-nowrap">
                  {username}/
                </span>
                <input
                  type="text"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-app-name"
                  className="w-full min-w-0 bg-transparent px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none"
                />
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Published at {APPS_HOST}. Leave blank to auto-generate a path.
              </p>
            </OptionCard>

            {optionCards}
          </>
        )}
      </div>

      <div className="shrink-0 px-6 pt-4 pb-5 space-y-3">
        {deployment ? (
          <>
            {isSignedIn ? (
              <PrimaryButton
                icon={<Rocket size={20} />}
                onClick={handleDeployClick}
                disabled={isDeploying || !canSubmitPassword}
              >
                Redeploy {Noun}
              </PrimaryButton>
            ) : (
              <PrimaryButton icon={<LogIn size={20} />} onClick={onRequireSignIn}>
                Sign in
              </PrimaryButton>
            )}
            {isSignedIn && (
              <button
                type="button"
                onClick={() => (confirmUndeploy ? onUndeploy() : setConfirmUndeploy(true))}
                disabled={isDeploying}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  confirmUndeploy
                    ? 'text-rose-600 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20'
                    : 'text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10'
                }`}
              >
                <Trash2 size={15} />
                {confirmUndeploy ? 'Really remove?' : 'Remove deployment'}
              </button>
            )}
          </>
        ) : !isSignedIn ? (
          <>
            <PrimaryButton icon={<LogIn size={20} />} onClick={onRequireSignIn}>
              Sign in
            </PrimaryButton>
            <button type="button" onClick={onClose} className={`${secondaryButtonClass} w-full`}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {username && (
              <PrimaryButton
                icon={<Rocket size={20} />}
                onClick={handleDeployClick}
                disabled={isDeploying || !hasCode || !canSubmitPassword}
              >
                Deploy {Noun}
              </PrimaryButton>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isDeploying}
              className={`${secondaryButtonClass} w-full`}
            >
              Cancel
            </button>
          </>
        )}
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400 pt-0.5">
          <ShieldCheck size={13} />
          Secure deployment with a unique public URL.
        </p>
      </div>
    </Modal>
  );
}
