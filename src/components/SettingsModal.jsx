import { useRef, useState } from 'react';
import { Sun, Moon, Monitor, X, Palette, LayoutGrid, Sparkles, Trash2, ShieldAlert, TriangleAlert, HardDrive, FileText, ExternalLink, Network, RotateCcw } from 'lucide-react';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';
import DataSettings from './DataSettings';
import DesktopProviderSettings from './DesktopProviderSettings';
import {
  SettingRow, Switch, TabList, PRIMARY_BUTTON, SECONDARY_BUTTON, TAB_PANEL_CLASS,
} from './SettingControls';
import { isDesktop } from '../lib/desktop';
import {
  CHAT_FONT_OPTIONS, REASONING_EFFORT_OPTIONS,
  loadCheckUpdates, saveCheckUpdates,
} from '../lib/config';
import { CURRENT_VERSION } from '../lib/updates';

// Settings modal, split into tabs: Appearance (theme from useTheme in App, chat
// font size from useChatFont, build pane side), Workspace (code view, splash),
// AI (building reasoning, clarifying questions) and Data (project backup and
// the desktop projects folder). AppBlips is a desktop, single-user app, so
// there is no account or billing tab.
const CHAT_FONT_LABELS = { small: 'Small', default: 'Default', large: 'Large', xlarge: 'XL' };
// The option buttons show an "A" at the size it selects -- the preview IS the label.
const CHAT_FONT_PREVIEW = { small: 'text-[12px]', default: 'text-sm', large: 'text-base', xlarge: 'text-lg' };
const REASONING_EFFORT_LABELS = { none: 'Off', low: 'Low', high: 'High' };

const TABS = [
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'workspace', label: 'Workspace', Icon: LayoutGrid },
  { id: 'ai', label: 'AI', Icon: Sparkles },
  { id: 'api', label: 'API', Icon: Network },
  { id: 'data', label: 'Data', Icon: HardDrive },
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

const LEGAL_LINKS = [
  { id: 'legal-privacy', title: 'Privacy Policy', description: 'How AppBlips collects, uses and protects your data.', href: 'https://www.appblips.com/privacy' },
  { id: 'legal-terms', title: 'Terms of Service', description: 'The terms that apply when you use AppBlips.', href: 'https://www.appblips.com/terms' },
];

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
  onResetApp,
  onRestartOnboarding,
  projectCount = 0,
  initialTab = null,
}) {
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

  const [confirmResetApp, setConfirmResetApp] = useState(false);
  const [isResettingApp, setIsResettingApp] = useState(false);

  const handleDeleteAll = async () => {
    setIsDeletingAll(true);
    setDeleteAllError(null);
    const ok = await onDeleteAllProjects();
    setIsDeletingAll(false);
    setConfirmDeleteAll(false);
    if (!ok) setDeleteAllError('Some apps could not be deleted. Try again.');
  };

  const handleResetAppConfirm = async () => {
    setIsResettingApp(true);
    await onResetApp();
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
              <SettingRow
                id="set-updates"
                title="Check for updates"
                description={`You're on AppBlips ${CURRENT_VERSION}. When on, AppBlips asks GitHub about new versions${isDesktop ? ' and downloads them in the background where it can' : ''}. GitHub sees your IP address. Takes effect on the next launch.`}
              >
                <Switch checked={checkUpdates} onChange={onCheckUpdatesChange} labelledBy="set-updates" />
              </SettingRow>
              {onRestartOnboarding && (
                <SettingRow id="set-onboarding" title="Replay onboarding" description="Walk through the welcome introduction and AI setup again. Your current AI setup is kept unless you save a new one.">
                  <button
                    type="button"
                    onClick={() => leaveAfterCheck(onRestartOnboarding)}
                    aria-labelledby="set-onboarding"
                    className={SECONDARY_BUTTON}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    Replay
                  </button>
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
                description={deleteAllError || 'Permanently remove every saved app with its version history. This cannot be undone.'}
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
              <SettingRow
                id="set-reset-app"
                title="Reset app to factory defaults"
                description="Clear all data, settings, API keys, and projects. This resets the entire app to its beginning state."
              >
                <button
                  type="button"
                  onClick={() => setConfirmResetApp(true)}
                  disabled={isResettingApp}
                  aria-labelledby="set-reset-app"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <ShieldAlert size={14} aria-hidden="true" />
                  Factory Reset
                </button>
              </SettingRow>
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
            </>
          )}

          {tab === 'api' && (
            <DesktopProviderSettings guardRef={providerGuardRef} />
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
              Every saved app and its version history will be permanently deleted. This cannot be undone.
            </span>
          </div>
        </ConfirmModal>
      )}
      {confirmResetApp && (
        <ConfirmModal
          title="Factory Reset?"
          subtitle="Everything will be wiped out."
          onClose={() => { if (!isResettingApp) setConfirmResetApp(false); }}
          onConfirm={handleResetAppConfirm}
          confirmLabel="Reset App"
          busyLabel="Resetting…"
          busy={isResettingApp}
          confirmClass="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
            <TriangleAlert size={18} className="text-red-500 shrink-0 mt-0.5" />
            <span>
              All apps, history, and settings will be permanently removed. The app will restart. This cannot be undone.
            </span>
          </div>
        </ConfirmModal>
      )}
    </Modal>
  );
}
