import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Monitor, X, Palette, LayoutGrid, Sparkles, Trash2, ShieldAlert, TriangleAlert, Eye, EyeOff, Loader2, CircleCheck, CircleAlert, HardDrive, User, Mail, LogOut, FileText, ExternalLink } from 'lucide-react';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';
import DataSettings from './DataSettings';
import DesktopProviderSettings from './DesktopProviderSettings';
import {
  SettingRow, Switch, TabList, FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON, TAB_PANEL_CLASS,
} from './SettingControls';
import { firebaseEnabled } from '../firebase';
import { isDesktop } from '../lib/desktop';
import {
  CHAT_FONT_OPTIONS, REASONING_EFFORT_OPTIONS,
  loadUserProvider, saveUserProvider, clearUserProvider, activeUserProvider,
  loadCheckUpdates, saveCheckUpdates,
} from '../lib/config';
import { CURRENT_VERSION } from '../lib/updates';
import { requestModelText, CHAT_REASONING_EFFORT } from '../lib/llm';
import { USER_PROVIDER_OPTIONS } from '../../functions/_lib/providers.js';
import { openBillingPortal } from '../lib/billing';

// Settings modal, split into tabs: Appearance (theme from useTheme in App, chat
// font size from useChatFont, build pane side), Workspace (code view, splash)
// and AI (building reasoning, clarifying questions, own provider).
// By default the LLM provider/key/model come from server env (see
// functions/_lib/chatProxy.js). The AI tab can also set the user's own
// provider preset, model and key, stored only in this browser (lib/config)
// and sent with each /api/chat request; reasoning effort is a per-user choice.
// The desktop app swaps that for DesktopProviderSettings (key kept in the main
// process). Data (self-hosted and desktop only) holds project backup/import
// and the desktop projects folder.
const CHAT_FONT_LABELS = { small: 'Small', default: 'Default', large: 'Large', xlarge: 'XL' };
// The option buttons show an "A" at the size it selects -- the preview IS the label.
const CHAT_FONT_PREVIEW = { small: 'text-[12px]', default: 'text-sm', large: 'text-base', xlarge: 'text-lg' };
const REASONING_EFFORT_LABELS = { none: 'Off', low: 'Low', high: 'High' };

const TABS = [
  ...(firebaseEnabled ? [{ id: 'account', label: 'Account', Icon: User }] : []),
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'workspace', label: 'Workspace', Icon: LayoutGrid },
  { id: 'ai', label: 'AI', Icon: Sparkles },
  ...(firebaseEnabled ? [] : [{ id: 'data', label: 'Data', Icon: HardDrive }]),
  { id: 'legal', label: 'Legal', Icon: FileText },
  { id: 'danger', label: 'Danger Zone', Icon: ShieldAlert },
];
const TAB_STORAGE_KEY = 'orion-settings-tab';

const loadTab = () => {
  try {
    const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
    return TABS.some((t) => t.id === stored) ? stored : TABS[0].id;
  } catch {
    return TABS[0].id;
  }
};

function Segmented({ label, value, options, onChange, renderOption }) {
  return (
    <div className="nav-segmented-group" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.ariaLabel}
          title={option.ariaLabel}
          onClick={() => onChange(option.value)}
          className={`nav-segmented-btn ${value === option.value ? 'nav-segmented-btn-active' : ''}`}
        >
          {renderOption ? renderOption(option) : <span>{option.label}</span>}
        </button>
      ))}
    </div>
  );
}

const INPUT_CLASS = `mt-1.5 ${FIELD_CLASS}`;
const providerLabel = (id) => USER_PROVIDER_OPTIONS.find((p) => p.id === id)?.label || id;
const providerModels = (id) => USER_PROVIDER_OPTIONS.find((p) => p.id === id)?.models || [];

const blankProvider = () => ({ enabled: false, id: USER_PROVIDER_OPTIONS[0].id, model: '', apiKey: '', remember: true });
const normalizeProviderDraft = (value) => {
  const id = USER_PROVIDER_OPTIONS.some((p) => p.id === value?.id) ? value.id : USER_PROVIDER_OPTIONS[0].id;
  const model = providerModels(id).some((option) => option.id === value?.model) ? value.model : '';
  return { ...value, id, model };
};
const initialDraft = () => {
  const saved = loadUserProvider();
  if (!saved) return blankProvider();
  return normalizeProviderDraft(saved);
};

// The user's own provider (a preset, a model and a key) instead of the
// server's env provider. The on/off switch applies at once; field edits are a
// draft until Save, so a half-typed key is never used or stored. `guardRef`
// lets the modal stop the user leaving with unsaved edits.
function UserProviderSettings({ guardRef }) {
  const [draft, setDraft] = useState(initialDraft);
  const [saved, setSaved] = useState(() => loadUserProvider());
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'testing' | 'ok' | 'error', text }
  const [active, setActive] = useState(() => activeUserProvider());

  const update = (fields) => {
    setDraft((d) => ({ ...d, ...fields }));
    setStatus(null);
  };
  const persist = (next) => {
    if (!saveUserProvider(next)) {
      setStatus({ kind: 'error', text: 'Could not save: browser storage is unavailable.' });
      return false;
    }
    setSaved(next);
    setActive(activeUserProvider());
    return true;
  };

  const complete = draft.model.trim() && draft.apiKey.trim();
  // Field edits Save hasn't stored yet (only while the switch is on: the
  // fields are hidden otherwise).
  const base = saved
    ? normalizeProviderDraft(saved)
    : blankProvider();
  const unsaved = draft.enabled && (
    draft.id !== base.id
    || draft.model.trim() !== base.model
    || draft.apiKey.trim() !== base.apiKey
    || draft.remember !== base.remember
  );
  const dirty = !saved
    || saved.id !== draft.id
    || saved.model !== draft.model.trim()
    || saved.apiKey !== draft.apiKey.trim()
    || saved.remember !== draft.remember;

  const onToggle = (enabled) => {
    update({ enabled });
    persist({ ...(saved || { ...draft, model: '', apiKey: '' }), enabled });
  };

  // Returns whether it saved, for the leave-with-unsaved-changes dialog.
  const onSave = () => {
    const next = { ...draft, model: draft.model.trim(), apiKey: draft.apiKey.trim(), enabled: true };
    if (!persist(next)) return false;
    setDraft(next);
    setStatus({ kind: 'ok', text: 'Saved.' });
    return true;
  };

  useEffect(() => {
    if (!guardRef) return undefined;
    guardRef.current = { unsaved, complete: Boolean(complete), save: onSave };
    return () => { guardRef.current = null; };
  });

  const onTest = async () => {
    setStatus({ kind: 'testing', text: 'Testing…' });
    try {
      await requestModelText({
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        askMode: true,
        // The same effort the app's own chat calls use. 'none' would ask
        // some models to switch thinking off, which always-thinking models
        // (e.g. Z.ai glm-5.3-flash) reject, failing a working setup.
        reasoningEffort: CHAT_REASONING_EFFORT,
        userProvider: { id: draft.id, model: draft.model.trim(), apiKey: draft.apiKey.trim() },
        retry: false,
      });
      setStatus({ kind: 'ok', text: `Connected to ${providerLabel(draft.id)}.` });
    } catch (err) {
      setStatus({ kind: 'error', text: err?.message || 'The test request failed.' });
    }
  };

  const onClear = () => {
    clearUserProvider();
    setSaved(null);
    setActive(null);
    setDraft(blankProvider());
    setShowKey(false);
    setStatus(null);
  };

  const summary = !draft.enabled
    ? "Off. The app's default AI provider is used."
    : active
      ? `On. Using ${providerLabel(active.id)} · ${active.model}.`
      : "Not active yet: save a model and API key. Until then the app's default provider is used.";

  return (
    <div className="py-4 last:pb-0">
      <SettingRow id="set-own-provider" title="Use my OpenRouter key" description={summary}>
        <Switch checked={draft.enabled} onChange={onToggle} labelledBy="set-own-provider" />
      </SettingRow>

      {draft.enabled && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-slate-600">
            Model
            <select
              value={draft.model}
              onChange={(e) => update({ model: e.target.value })}
              className={`${INPUT_CLASS} bg-surface`}
            >
              <option value="" className="bg-surface text-slate-900">Select a coding model…</option>
              {providerModels(draft.id).map((model) => (
                <option key={model.id} value={model.id} className="bg-surface text-slate-900">{model.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-600">
            OpenRouter API key
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder={`Your ${providerLabel(draft.id)} API key`}
                autoComplete="off"
                spellCheck={false}
                className={`${INPUT_CLASS} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute inset-y-0 right-0 mt-1.5 flex items-center px-3.5 text-slate-400 hover:text-slate-700 transition-colors"
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <div className="flex items-center justify-between gap-4">
            <span id="set-provider-remember" className="text-sm text-slate-600">
              Remember on this device
              <span className="block text-xs text-slate-500">When off, the key is forgotten when this tab closes.</span>
            </span>
            <Switch checked={draft.remember} onChange={(remember) => update({ remember })} labelledBy="set-provider-remember" />
          </div>
          <p className="text-xs text-slate-500 leading-snug">
            Your key stays in this browser, never in your projects. It is sent to this app&apos;s server, which passes it to {providerLabel(draft.id)} for each request.
            Published and exported apps that use AI keep using the app&apos;s default provider.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={!complete || !dirty || status?.kind === 'testing'}
              className="brand-fill-text rounded-lg px-4 py-1.5 bg-brand text-white font-semibold text-sm hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              Save
            </button>
            <button type="button" onClick={onTest} disabled={!complete || status?.kind === 'testing'} className={SECONDARY_BUTTON}>
              Test connection
            </button>
            <button type="button" onClick={onClear} disabled={!saved && !complete} className={SECONDARY_BUTTON}>
              Clear
            </button>
            {status && (
              <span
                role={status.kind === 'error' ? 'alert' : 'status'}
                className={`inline-flex items-center gap-1.5 text-xs ${status.kind === 'error' ? 'text-red-600' : status.kind === 'ok' ? 'text-emerald-600' : 'text-slate-500'}`}
              >
                {status.kind === 'testing' && <Loader2 size={14} className="animate-spin" />}
                {status.kind === 'ok' && <CircleCheck size={14} />}
                {status.kind === 'error' && <CircleAlert size={14} />}
                {status.text}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const LEGAL_LINKS = [
  { id: 'legal-privacy', title: 'Privacy Policy', description: 'How AppBlips collects, uses and protects your data.', href: 'https://www.appblips.com/privacy' },
  { id: 'legal-terms', title: 'Terms of Service', description: 'The terms that apply when you use AppBlips.', href: 'https://www.appblips.com/terms' },
];
const PLAN_LABELS = { none: 'No plan', plus: 'Plus', pro: 'Pro' };

export default function SettingsModal({
  onClose,
  themePreference,
  onThemePreferenceChange,
  resolvedTheme,
  chatFont,
  onChatFontChange,
  showCodeView,
  onShowCodeViewChange,
  askClarifyingQuestions,
  onAskClarifyingQuestionsChange,
  gameEngineRouter,
  onGameEngineRouterChange,
  skipSplash,
  onSkipSplashChange,
  autoFollowCode,
  onAutoFollowCodeChange,
  liveCodePreview,
  onLiveCodePreviewChange,
  buildPaneSide,
  onBuildPaneSideChange,
  buildReasoningEffort,
  onBuildReasoningEffortChange,
  onDeleteAllProjects,
  projectCount = 0,
  onDeleteAccount,
  initialTab = null,
  user,
  username,
  usernameLoading,
  onSignOut,
  billingPlan = null,
  billingTrialing = false,
  billingHasAccount = false,
  onOpenPlans,
}) {
  const [portal, setPortal] = useState({ busy: false, error: '' });
  // Leaves for Stripe's Customer Portal; on success the page navigates away,
  // so busy only resets on failure.
  const openPortal = async () => {
    setPortal({ busy: true, error: '' });
    try {
      await openBillingPortal();
    } catch (err) {
      setPortal({ busy: false, error: err?.message || 'Could not open billing. Please try again.' });
    }
  };
  const [tab, setTab] = useState(() => (TABS.some((t) => t.id === initialTab) ? initialTab : loadTab()));
  const [checkUpdates, setCheckUpdates] = useState(loadCheckUpdates);
  const onCheckUpdatesChange = (enabled) => {
    setCheckUpdates(enabled);
    saveCheckUpdates(enabled);
  };
  // The AI tab's provider panel reports unsaved edits here. Leaving the tab or
  // closing Settings with any asks first (Save / Discard / Keep editing), so
  // details typed in aren't silently lost by clicking Done.
  const providerGuardRef = useRef(null);
  const [pendingLeave, setPendingLeave] = useState(null); // { run, complete } while asking
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const leaveAfterCheck = (run) => {
    const guard = providerGuardRef.current;
    if (guard?.unsaved) setPendingLeave({ run, complete: guard.complete });
    else run();
  };
  const saveProviderAndLeave = async () => {
    setIsSavingProvider(true);
    const ok = await providerGuardRef.current?.save();
    setIsSavingProvider(false);
    const leave = pendingLeave;
    setPendingLeave(null);
    if (ok) leave?.run();
  };
  const discardProviderAndLeave = () => {
    const leave = pendingLeave;
    setPendingLeave(null);
    leave?.run();
  };
  const closeSettings = () => leaveAfterCheck(onClose);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState(null);

  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [accountConfirmText, setAccountConfirmText] = useState('');
  const [deleteAccountError, setDeleteAccountError] = useState(null);

  const closeAccountConfirm = () => {
    if (isDeletingAccount) return;
    setConfirmDeleteAccount(false);
    setAccountConfirmText('');
    setDeleteAccountError(null);
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      await onDeleteAccount();
    } catch (err) {
      const code = err?.code || '';
      setDeleteAccountError(
        /popup-closed|cancelled-popup/.test(code) ? 'Verification was cancelled.'
          : err?.message || 'Could not delete your account.'
      );
      setIsDeletingAccount(false);
    }
  };

  const handleDeleteAll = async () => {
    setIsDeletingAll(true);
    setDeleteAllError(null);
    const ok = await onDeleteAllProjects();
    setIsDeletingAll(false);
    setConfirmDeleteAll(false);
    if (!ok) setDeleteAllError('Some apps could not be deleted. Check your connection and try again.');
  };
  const selectTab = (id) => {
    if (id === tab) return;
    leaveAfterCheck(() => {
      setTab(id);
      try { sessionStorage.setItem(TAB_STORAGE_KEY, id); } catch { /* storage unavailable */ }
    });
  };

  return (
    <Modal
      zIndex={60}
      cardClass="w-full max-w-lg sm:max-w-2xl xl:max-w-3xl max-h-[90vh] bg-surface rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'settings-title' }}
    >
      <div className="shrink-0 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <h2 id="settings-title" className="text-xl font-bold text-slate-900">Settings</h2>
        <button
          type="button"
          onClick={closeSettings}
          className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
        <TabList tabs={TABS} active={tab} onSelect={selectTab} idPrefix="settings" label="Settings categories" />

        <div
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
          tabIndex={0}
          className={`${TAB_PANEL_CLASS} divide-y divide-slate-200`}
        >
          {tab === 'account' && (
            <>
              <SettingRow id="account-email" title="Email Address" description="From the Google or GitHub account you sign in with.">
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm">
                  <Mail size={16} />
                  <span>{user?.email}</span>
                </div>
              </SettingRow>
              <SettingRow id="account-username" title="Username" description={username ? "Your username is permanent and used in your app's public URLs." : "You'll choose a username the first time you deploy an app. It can't be changed once set."}>
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm">
                  <User size={16} />
                  <span>{usernameLoading ? 'Loading...' : (username || 'Not set yet')}</span>
                </div>
              </SettingRow>
              {billingPlan && (
                <SettingRow id="account-plan" title="Plan" description={billingPlan === 'none' ? 'You are not on a plan yet. Start the free trial to begin building.' : billingTrialing ? 'You are on the Free Trial.' : 'The plan your account is enrolled in.'}>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm">
                      <Sparkles size={16} />
                      <span>{PLAN_LABELS[billingPlan] || billingPlan}{billingTrialing && billingPlan === 'plus' ? ' (free trial)' : ''}</span>
                    </div>
                    {onOpenPlans && (
                      <button type="button" onClick={() => { onClose(); onOpenPlans(); }} className={SECONDARY_BUTTON}>
                        {billingPlan === 'none' ? 'See plans' : 'Manage'}
                      </button>
                    )}
                  </div>
                </SettingRow>
              )}
              {billingHasAccount && (
                <SettingRow id="account-billing" title="Billing and invoices" description="View and download invoices, update your card, or cancel your plan in Stripe.">
                  <div className="flex flex-col items-end gap-1.5">
                    <button type="button" onClick={openPortal} disabled={portal.busy} className={SECONDARY_BUTTON}>
                      {portal.busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                      Open billing
                    </button>
                    {portal.error && <p role="alert" className="text-xs text-red-600">{portal.error}</p>}
                  </div>
                </SettingRow>
              )}
              <SettingRow id="account-signout" title="Sign out" description="Sign out of your account on this device.">
                <button
                  type="button"
                  onClick={() => { onClose(); onSignOut?.(); }}
                  className={SECONDARY_BUTTON}
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </SettingRow>
            </>
          )}

          {tab === 'appearance' && (
            <>
              <SettingRow
                id="set-theme"
                title="Theme"
                description={
                  themePreference === 'system'
                    ? `Following your system setting — currently ${resolvedTheme}.`
                    : `Always ${themePreference}. Your system setting is ignored.`
                }
              >
                <Segmented
                  label="Theme"
                  value={themePreference}
                  onChange={onThemePreferenceChange}
                  options={[
                    { value: 'light', label: 'Light', Icon: Sun },
                    { value: 'dark', label: 'Dark', Icon: Moon },
                    { value: 'system', label: 'System', Icon: Monitor },
                  ]}
                  renderOption={(o) => (<><o.Icon size={14} /><span>{o.label}</span></>)}
                />
              </SettingRow>
              <SettingRow
                id="set-font"
                title="Build pane font"
                description="Text size for the entire build pane, including starter ideas, chat conversation, and prompt input."
              >
                <Segmented
                  label="Build pane font size"
                  value={chatFont}
                  onChange={onChatFontChange}
                  options={CHAT_FONT_OPTIONS.map((value) => ({ value, label: CHAT_FONT_LABELS[value], ariaLabel: CHAT_FONT_LABELS[value] }))}
                  renderOption={(o) => (
                    <>
                      <span className={`font-semibold leading-none ${CHAT_FONT_PREVIEW[o.value]}`}>A</span>
                      <span className="sr-only">{o.label}</span>
                    </>
                  )}
                />
              </SettingRow>
              <SettingRow
                id="set-side"
                title="Build pane position"
                description="Show the build pane on the left or right of the preview. Applies on wider screens."
              >
                <Segmented
                  label="Build pane position"
                  value={buildPaneSide}
                  onChange={onBuildPaneSideChange}
                  options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
                />
              </SettingRow>
            </>
          )}

          {tab === 'workspace' && (
            <>
              <SettingRow id="set-code" title="Code view" description="Show the Code tab in the preview toolbar to inspect the generated HTML.">
                <Switch checked={showCodeView} onChange={onShowCodeViewChange} labelledBy="set-code" />
              </SettingRow>
              <SettingRow id="set-follow" title="Auto Follow Code" description="Auto-scroll the Code tab to follow the latest line as the app is generated.">
                <Switch checked={autoFollowCode} onChange={onAutoFollowCodeChange} labelledBy="set-follow" />
              </SettingRow>
              <SettingRow id="set-livecode" title="Live code preview" description="Show the code being written in the preview pane while an app is generated.">
                <Switch checked={liveCodePreview} onChange={onLiveCodePreviewChange} labelledBy="set-livecode" />
              </SettingRow>
              <SettingRow id="set-splash" title="Skip splash screen" description="Skip the intro animation on launch. Takes effect on the next page load.">
                <Switch checked={skipSplash} onChange={onSkipSplashChange} labelledBy="set-splash" />
              </SettingRow>
              {!firebaseEnabled && (
                <SettingRow
                  id="set-updates"
                  title="Check for updates"
                  description={`You're on AppBlips ${CURRENT_VERSION}. When on, AppBlips asks GitHub about new versions${isDesktop ? ' and downloads them in the background where it can' : ''}. GitHub sees your IP address. Takes effect on the next launch.`}
                >
                  <Switch checked={checkUpdates} onChange={onCheckUpdatesChange} labelledBy="set-updates" />
                </SettingRow>
              )}
            </>
          )}

          {tab === 'data' && <DataSettings />}

          {tab === 'legal' && (
            <>
              {LEGAL_LINKS.map(({ id, title, description, href }) => (
                <SettingRow key={id} id={id} title={title} description={description}>
                  <a href={href} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
                    <ExternalLink size={14} />
                    View
                  </a>
                </SettingRow>
              ))}
            </>
          )}

          {tab === 'danger' && (
            <>
              <SettingRow
                id="set-delete-all"
                title="Delete all saved apps"
                description={deleteAllError || 'Permanently remove every saved app, including any published links and cloud copies. This cannot be undone.'}
              >
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAll(true)}
                  disabled={isDeletingAll}
                  aria-labelledby="set-delete-all"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Delete all
                </button>
              </SettingRow>
              {onDeleteAccount && (
                <SettingRow
                  id="set-delete-account"
                  title="Delete account"
                  description="Permanently delete your account, all saved apps, published links and profile. This cannot be undone."
                >
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAccount(true)}
                    aria-labelledby="set-delete-account"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete account
                  </button>
                </SettingRow>
              )}
            </>
          )}

          {tab === 'ai' && (
            <>
              <SettingRow
                id="set-reasoning-build"
                title="Reasoning: building"
                description="Let the AI reason before generating a new app from scratch. Low is faster and cheaper; High thinks harder for complex apps."
              >
                <Segmented
                  label="Reasoning for building"
                  value={buildReasoningEffort}
                  onChange={onBuildReasoningEffortChange}
                  options={REASONING_EFFORT_OPTIONS.map((value) => ({ value, label: REASONING_EFFORT_LABELS[value] }))}
                />
              </SettingRow>
              <SettingRow id="set-clarify" title="Clarifying questions" description="Allow the AI to ask helpful clarifying questions about your prompt before generating the code.">
                <Switch checked={askClarifyingQuestions} onChange={onAskClarifyingQuestionsChange} labelledBy="set-clarify" />
              </SettingRow>
              <SettingRow id="set-engine-router" title="Smart game engine" description="Before building a new game, the AI picks the best engine for it: Phaser for platformers, shooters and RPGs, Three.js for 3D, and no engine (faster to load) for simple arcade, puzzle and card games. Naming an engine in your prompt always wins. Off lets the builder choose as it writes.">
                <Switch checked={gameEngineRouter} onChange={onGameEngineRouterChange} labelledBy="set-engine-router" />
              </SettingRow>
              {isDesktop && <DesktopProviderSettings guardRef={providerGuardRef} />}
              {!isDesktop && !firebaseEnabled && <UserProviderSettings guardRef={providerGuardRef} />}
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 bg-slate-50 border-t border-slate-200 px-6 py-3 flex justify-end gap-3">
        <button
          type="button"
          onClick={closeSettings}
          className={PRIMARY_BUTTON}
        >
          Done
        </button>
      </div>
      {pendingLeave && (
        <ConfirmModal
          title="Save your AI provider?"
          subtitle="You changed it but haven't saved."
          onClose={() => { if (!isSavingProvider) setPendingLeave(null); }}
          cancelLabel="Keep editing"
          secondaryLabel="Discard changes"
          onSecondary={discardProviderAndLeave}
          onConfirm={saveProviderAndLeave}
          confirmLabel="Save"
          busyLabel="Saving…"
          busy={isSavingProvider}
          confirmDisabled={!pendingLeave.complete}
          confirmClass={PRIMARY_BUTTON}
        >
          <p className="text-sm text-slate-600 leading-relaxed">
            {pendingLeave.complete
              ? 'Save the provider, model and API key you entered so AppBlips can use them?'
              : 'The model or API key is still empty. Fill them in and save, or discard your changes.'}
          </p>
        </ConfirmModal>
      )}
      {confirmDeleteAccount && (
        <ConfirmModal
          title="Delete your account?"
          subtitle="This permanently removes everything."
          onClose={closeAccountConfirm}
          onConfirm={handleDeleteAccount}
          confirmLabel="Delete account"
          busyLabel="Deleting…"
          busy={isDeletingAccount}
          confirmDisabled={accountConfirmText !== 'DELETE'}
          confirmClass="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-red-500 shrink-0 mt-0.5" />
            <span>
              Your account, every saved app with its version history, and all published links will be permanently deleted. Your username stays reserved. This cannot be undone.
            </span>
          </div>
          <label className="block text-sm text-slate-600">
            Type <span className="font-semibold text-slate-900">DELETE</span> to confirm
            <input
              type="text"
              value={accountConfirmText}
              onChange={(e) => setAccountConfirmText(e.target.value)}
              autoComplete="off"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-slate-500">You&apos;ll be asked to sign in again with your provider to verify it&apos;s you.</p>
          {deleteAccountError && <p role="alert" className="text-sm text-red-600">{deleteAccountError}</p>}
        </ConfirmModal>
      )}
      {confirmDeleteAll && (
        <ConfirmModal
          title="Delete all saved apps?"
          subtitle={projectCount ? `${projectCount} saved ${projectCount === 1 ? 'app' : 'apps'} will be removed.` : undefined}
          onClose={() => { if (!isDeletingAll) setConfirmDeleteAll(false); }}
          onConfirm={handleDeleteAll}
          confirmLabel="Delete all"
          busyLabel="Deleting…"
          busy={isDeletingAll}
          confirmClass="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-red-500 shrink-0 mt-0.5" />
            <span>
              Every saved app and its version history will be permanently deleted, and any published public links will stop working. This cannot be undone.
            </span>
          </div>
        </ConfirmModal>
      )}
    </Modal>
  );
}
