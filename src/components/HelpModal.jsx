import { useMemo, useState } from 'react';
import {
  CircleHelp, X, ChevronLeft, ChevronRight, Sparkles, Wand2, Monitor, History,
  FolderOpen, Rocket, Download, Settings, Lightbulb, SquarePen,
  MessageCircleQuestion, Square, TriangleAlert, Layers, Eye, Smartphone, RotateCw,
  Undo2, ZoomIn, ExternalLink, Info, PanelLeftOpen, Clock, Play, Copy, Pencil,
  Check, Trash2, Plus, RotateCcw, RefreshCw, Link, Globe, KeyRound, EyeOff,
  Image, Settings2, Code2, Upload, Sun, Type, MessagesSquare
} from 'lucide-react';
import Modal from './Modal';
import { firebaseEnabled } from '../firebase';

// The in-app user guide: how to build, refine, preview, version, save and share
// an app. Deliberately covers the UI only -- nothing about server config or
// setup. The copy is universal except for the "share" section, which branches on
// `firebaseEnabled` because that is the one difference a user actually sees (the
// preview toolbar's Deploy button vs. Export button).
//
// Section bodies are plain JSX rather than a data array: they're heterogeneous
// (numbered steps, grouped item rows, a keyboard legend, plain bullets) and the
// copy needs inline <strong>/<kbd>, so a generic renderer would need its own
// mini-DSL to say what JSX already says.

// --- Presentational primitives -------------------------------------------

function HelpSection({ title, intro, children }) {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">{title}</h3>
        <p className="text-sm text-slate-600 leading-relaxed max-w-[62ch]">{intro}</p>
      </div>
      {children}
    </section>
  );
}

function HelpGroup({ label, children }) {
  return (
    <div className="space-y-2.5">
      <h4 className="text-xs 2xl:text-sm font-bold uppercase tracking-[0.14em] text-indigo-600">{label}</h4>
      {children}
    </div>
  );
}

// Container for HelpItem rows: one column until there's room for two.
function HelpItems({ children }) {
  return (
    <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
      {children}
    </ul>
  );
}

function HelpItem({ icon: Icon, name, children }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-surface px-3.5 py-3 shadow-2xs">
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600"
        aria-hidden="true"
      >
        {Icon && <Icon size={15} />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 leading-snug">{name}</p>
        <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{children}</p>
      </div>
    </li>
  );
}

function HelpStep({ n, title, children }) {
  return (
    <li className="flex items-start gap-3.5">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full brand-gradient text-white text-xs font-bold ring-1 ring-black/5 dark:ring-white/10"
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-semibold text-slate-900 leading-snug">{title}</p>
        <p className="text-sm text-slate-600 leading-relaxed mt-1 max-w-[62ch]">{children}</p>
      </div>
    </li>
  );
}

function HelpNote({ icon: Icon = Lightbulb, children }) {
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-slate-600 leading-relaxed flex items-start gap-3">
      {Icon && <Icon size={18} className="text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}

function Kbd({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-slate-300 bg-surface text-[10px] leading-none text-slate-600 font-bold shadow-2xs uppercase tracking-wider">
      {children}
    </kbd>
  );
}

function HelpTip({ children }) {
  return (
    <li className="flex gap-2.5">
      <Check size={15} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />
      <p className="text-sm text-slate-600 leading-relaxed">{children}</p>
    </li>
  );
}

// --- Section bodies ------------------------------------------------------

function QuickStartSection() {
  return (
    <HelpSection
      title="Quick start"
      intro="Three steps from an idea to a working app."
    >
      <ol className="space-y-5">
        <HelpStep n={1} title="Describe your idea">
          Type what you want into the box on the left, in plain words.
          &ldquo;A shopping list that remembers what I buy most&rdquo; is enough to start.
          Short of ideas? Click a <strong>Starter idea</strong> card &mdash; it fills the box
          without sending, so you can reword it first.
        </HelpStep>
        <HelpStep n={2} title="Name it, then build">
          The first time you send a prompt, you&rsquo;ll be asked to name the app.
          Then it&rsquo;s written and run on the right, live, as it comes together.
        </HelpStep>
        <HelpStep n={3} title="Refine it">
          Ask for one change at a time: &ldquo;make the buttons bigger&rdquo;, &ldquo;add a dark
          mode&rdquo;. Each build is kept as a version, so you can always go back.
        </HelpStep>
      </ol>
      <HelpNote>
        Your work saves itself after every build. There&rsquo;s no Save button to remember.
      </HelpNote>
    </HelpSection>
  );
}

function BuildingSection() {
  return (
    <HelpSection
      title="Building &amp; refining"
      intro="The left panel is where you describe what you want. It starts as an empty prompt box and becomes a conversation once you build."
    >
      <HelpGroup label="The prompt box">
        <HelpItems>
          <HelpItem icon={SquarePen} name="Build App / Update App">
            Sends your prompt. It reads <strong>Build App</strong> for a brand-new app and
            <strong> Update App</strong> once one exists.
          </HelpItem>
          <HelpItem icon={MessageCircleQuestion} name="Ask mode">
            Switch the toggle to <strong>Ask</strong> and your question gets answered without
            changing anything. Good for &ldquo;where is the score saved?&rdquo;
          </HelpItem>
          <HelpItem icon={Square} name="Cancel">
            Stops a build that&rsquo;s running. Your current version stays exactly as it was.
          </HelpItem>
          <HelpItem icon={TriangleAlert} name="Build interrupted">
            If you close the tab mid-build, an amber banner offers that prompt back with a
            <strong> Retry</strong> button next time you open AppBlips.
          </HelpItem>
        </HelpItems>
      </HelpGroup>

      <HelpGroup label="Ideas and nudges">
        <HelpItems>
          <HelpItem icon={Sparkles} name="Starter ideas">
            Ready-made app ideas on the empty screen. Clicking one fills the box, it
            doesn&rsquo;t send.
          </HelpItem>
          <HelpItem icon={MessageCircleQuestion} name="Clarifying questions">
            Sometimes you&rsquo;ll get a short question before the build starts, so you can type
            your custom answer. Turn it off in Settings to always build straight away.
          </HelpItem>
          <HelpItem icon={Layers} name="Version ticks">
            Replies in the conversation are tagged v1, v2, v3&hellip; so you can match a message
            to the version it produced.
          </HelpItem>
        </HelpItems>
      </HelpGroup>

      <HelpGroup label="Keyboard">
        <div className="flex flex-wrap gap-x-6 gap-y-2.5 rounded-xl border border-slate-200/80 bg-surface px-4 py-3 shadow-2xs">
          <span className="flex items-center gap-2 text-xs text-slate-600">
            <Kbd>Enter</Kbd> Send
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-600">
            <Kbd>Shift</Kbd><Kbd>Enter</Kbd> New line
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-600">
            <Kbd>Ctrl</Kbd><Kbd>Enter</Kbd> Send
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-600">
            <Kbd>Alt</Kbd><Kbd>Enter</Kbd> New line
          </span>
        </div>
      </HelpGroup>
    </HelpSection>
  );
}

function PreviewSection() {
  return (
    <HelpSection
      title="Preview &amp; devices"
      intro="The right side runs your real app, not a picture of it. Click around in it the way anyone else would."
    >
      <HelpItems>
        <HelpItem icon={Eye} name="Preview and Code tabs">
          <strong>Preview</strong> runs the app. <strong>Code</strong> shows the HTML behind it,
          with a copy button. The Code tab stays hidden until you switch on Code view in Settings.
        </HelpItem>
        <HelpItem icon={Smartphone} name="Device sizes">
          <strong>Mobile</strong> (399 &times; 820), <strong>Tablet</strong> (810 &times; 1080) and
          <strong> Desktop</strong> (1468 &times; 1022), so you can check how your app behaves on each.
        </HelpItem>
        <HelpItem icon={RotateCw} name="Rotate">
          Flips mobile and tablet between portrait and landscape.
        </HelpItem>
        <HelpItem icon={Undo2} name="Undo and Redo">
          Step back and forward through your versions. They appear on wider screens once you
          have more than one.
        </HelpItem>
        <HelpItem icon={ZoomIn} name="Zoom">
          Zoom in or out by hand, or click <strong>Auto</strong> to fit the app to the pane again.
        </HelpItem>
        <HelpItem icon={ExternalLink} name="Open">
          Opens your app full size in a new browser tab.
        </HelpItem>
      </HelpItems>
      <HelpNote icon={Info}>
        The browser frame drawn around the desktop preview is decoration. Its address bar and
        buttons aren&rsquo;t live &mdash; use <strong>Open</strong> for a real browser tab.
      </HelpNote>
    </HelpSection>
  );
}

function HistorySection() {
  return (
    <HelpSection
      title="Versions &amp; history"
      intro="Every build makes a version. History groups them by chat session, newest chat first."
    >
      <HelpItems>
        <HelpItem icon={PanelLeftOpen} name="The History drawer">
          The <strong>History</strong> button in the top bar opens and closes it, on wider screens.
        </HelpItem>
        <HelpItem icon={MessagesSquare} name="Chat sessions">
          Versions are grouped under the chat they were built in. <strong>+</strong> (new chat)
          starts a fresh group; earlier groups and their conversation stay put.
        </HelpItem>
        <HelpItem icon={Clock} name="What a row shows">
          The version number, the prompt that made it, and when. <strong>Initial</strong> marks
          the first build; <strong>Active</strong> marks the one you&rsquo;re looking at.
        </HelpItem>
        <HelpItem icon={Play} name="Restore">
          Click any version to put it back in the preview &mdash; it also brings
          back the chat session it belongs to, so its conversation continues from
          there. Restoring an <strong>Ask</strong> answer rewinds only the
          conversation; your app in the preview stays exactly as it is.
        </HelpItem>
      </HelpItems>
      <HelpNote>
        Go back to an earlier version and build again, and the versions after it are replaced
        &mdash; the same way undo works in any editor.
      </HelpNote>
    </HelpSection>
  );
}

function AppsSection() {
  return (
    <HelpSection
      title="Your apps"
      intro="Everything you build is kept, named, and searchable."
    >
      <HelpItems>
        <HelpItem icon={Pencil} name="Naming">
          Your first prompt in a new app opens <strong>Name Your App</strong>. Pick something
          you&rsquo;ll recognise later &mdash; you can rename it any time.
        </HelpItem>
        <HelpItem icon={Check} name="Automatic saving">
          Saved after every build. There&rsquo;s nothing to click.
        </HelpItem>
        <HelpItem icon={FolderOpen} name="Apps">
          Lists everything you&rsquo;ve built, with how many versions each has and when you last
          touched it. Search by name, then <strong>Open</strong>.
        </HelpItem>
        <HelpItem icon={Pencil} name="Rename">
          The pencil on a card renames it in place. <Kbd>Enter</Kbd> saves, <Kbd>Esc</Kbd> cancels.
        </HelpItem>
        <HelpItem icon={Trash2} name="Delete">
          Removes an app and all of its versions. You&rsquo;ll be asked to confirm, and it
          can&rsquo;t be undone.
        </HelpItem>
        <HelpItem icon={Plus} name="New App">
          Clears the workspace for a fresh idea. If you have work in progress you&rsquo;ll see
          &ldquo;Start a new app?&rdquo; &mdash; choose <strong>Start New</strong> to go ahead.
        </HelpItem>
        <HelpItem icon={RotateCcw} name="Picking up again">
          Reopening AppBlips brings back the app you had open last.
        </HelpItem>
      </HelpItems>
    </HelpSection>
  );
}

// Shown under both branches of the share section.
function OtherWaysOut() {
  return (
    <HelpGroup label="Other ways to get your app out">
      <HelpItems>
        <HelpItem icon={Code2} name="Code tab → Copy">
          Copies the full HTML of the version you&rsquo;re looking at.
        </HelpItem>
        <HelpItem icon={History} name="History → Restore">
          Restores any earlier version&rsquo;s HTML into the code tab and preview.
        </HelpItem>
        <HelpItem icon={ExternalLink} name="Open">
          Opens the current version in a new browser tab, where you can save it from your browser.
        </HelpItem>
      </HelpItems>
    </HelpGroup>
  );
}

function DeploySection() {
  return (
    <HelpSection
      title="Deploy &amp; share"
      intro="Deploying puts your app on the web at its own link, so you can send it to someone."
    >
      <HelpItems>
        <HelpItem icon={Rocket} name="Deploy">
          The <strong>Deploy</strong> button above the preview publishes the version you&rsquo;re
          looking at and hands you a link.
        </HelpItem>
        <HelpItem icon={RefreshCw} name="Deployed and Update">
          Once published, the button reads <strong>Deployed</strong>. Make more changes and it
          reads <strong>Update</strong> with an amber dot: your link is still showing the older
          version until you deploy again.
        </HelpItem>
        <HelpItem icon={Link} name="The same link, every time">
          Deploying again reuses the link you already shared, so nobody has to be sent a new one.
        </HelpItem>
        <HelpItem icon={Globe} name="Choose the address">
          Set the last part of the link yourself, or leave it blank and one is generated for you.
        </HelpItem>
        <HelpItem icon={KeyRound} name="Password">
          Optional. Visitors type it before the app loads. Leave it blank for an open link.
        </HelpItem>
        <HelpItem icon={EyeOff} name="Search engines">
          Ask search engines not to list your app.
        </HelpItem>
        <HelpItem icon={Image} name="Icon">
          Upload a small image, under 200 KB, to show as the browser tab icon.
        </HelpItem>
        <HelpItem icon={Settings2} name="Managing it later">
          The same dialog gives you <strong>Copy link</strong>, <strong>Open</strong>,
          <strong> Redeploy</strong> and <strong>Remove</strong>.
        </HelpItem>
      </HelpItems>
      <HelpNote icon={Info}>
        Deploying needs an account and a username, so your app can be stored and stay reachable
        at a stable link. You can set your username in Account Settings.
      </HelpNote>
      <OtherWaysOut />
    </HelpSection>
  );
}

function ExportSection() {
  return (
    <HelpSection
      title="Export &amp; share"
      intro="Exporting saves your app as a single file you can keep, open, or put online yourself."
    >
      <HelpItems>
        <HelpItem icon={Download} name="Export">
          The <strong>Export</strong> button above the preview downloads the version you&rsquo;re
          looking at as one <code className="font-mono text-[11px]">.html</code> file.
        </HelpItem>
        <HelpItem icon={Globe} name="It runs anywhere">
          Open the file in any browser and your app runs. Everything it needs is inside that one
          file, so it works with no internet connection.
        </HelpItem>
        <HelpItem icon={Upload} name="Put it online">
          Because it&rsquo;s a single file, you can upload it to any web host or file-sharing
          service and share that link.
        </HelpItem>
      </HelpItems>
      <OtherWaysOut />
    </HelpSection>
  );
}

function SettingsSection() {
  return (
    <HelpSection
      title="Settings"
      intro="Small preferences, remembered in this browser."
    >
      <HelpItems>
        <HelpItem icon={Sun} name="Appearance">
          <strong>Light</strong>, <strong>Dark</strong>, or <strong>System</strong>, which follows
          your device.
        </HelpItem>
        <HelpItem icon={Type} name="Chat font">
          Small, Default, Large or XL text for the build conversation and its code snippets.
        </HelpItem>
        <HelpItem icon={Code2} name="Code view">
          Off by default. Turn it on to reveal the <strong>Code</strong> tab in the preview toolbar.
        </HelpItem>
        <HelpItem icon={MessageCircleQuestion} name="Clarifying questions">
          On by default. Turn it off to always build straight away, without being asked anything
          first.
        </HelpItem>
        <HelpItem icon={Wand2} name="Splash screen">
          Skip the intro animation on launch. Takes effect the next time the page loads.
        </HelpItem>
      </HelpItems>
    </HelpSection>
  );
}

function TipsSection() {
  return (
    <HelpSection
      title="Tips for better results"
      intro="A clear picture of what you want goes a long way. A few habits that help."
    >
      <ul className="space-y-3">
        <HelpTip>
          Describe the app, not the code. &ldquo;A budget tracker with monthly totals&rdquo; beats
          &ldquo;make a div with a table&rdquo;.
        </HelpTip>
        <HelpTip>
          Name the pieces you want: a list, a total at the bottom, a Clear button.
        </HelpTip>
        <HelpTip>
          Change one thing at a time when refining. Small requests land more reliably than long ones.
        </HelpTip>
        <HelpTip>
          Be precise about what&rsquo;s wrong. &ldquo;The total doesn&rsquo;t update when I delete a
          row&rdquo; is far more useful than &ldquo;it&rsquo;s broken&rdquo;.
        </HelpTip>
        <HelpTip>
          Use <strong>Ask</strong> when you want to understand something rather than change it.
        </HelpTip>
        <HelpTip>
          Borrow wording from <strong>Starter ideas</strong> when
          you&rsquo;re not sure how to phrase something.
        </HelpTip>
        <HelpTip>
          If a change goes wrong, restore the previous version from History and try different
          wording. That&rsquo;s what versions are for.
        </HelpTip>
      </ul>
    </HelpSection>
  );
}

// --- Section index -------------------------------------------------------

function buildHelpSections(hasDeploy) {
  return [
    { id: 'quick-start', label: 'Quick start', shortLabel: 'Start', Icon: Sparkles, render: QuickStartSection },
    { id: 'building', label: 'Building & refining', shortLabel: 'Build', Icon: Wand2, render: BuildingSection },
    { id: 'preview', label: 'Preview & devices', shortLabel: 'Preview', Icon: Monitor, render: PreviewSection },
    { id: 'history', label: 'Versions & history', shortLabel: 'History', Icon: History, render: HistorySection },
    { id: 'apps', label: 'Your apps', shortLabel: 'Apps', Icon: FolderOpen, render: AppsSection },
    hasDeploy
      ? { id: 'share', label: 'Deploy & share', shortLabel: 'Deploy', Icon: Rocket, render: DeploySection }
      : { id: 'share', label: 'Export & share', shortLabel: 'Export', Icon: Download, render: ExportSection },
    { id: 'settings', label: 'Settings', shortLabel: 'Settings', Icon: Settings, render: SettingsSection },
    { id: 'tips', label: 'Tips for better results', shortLabel: 'Tips', Icon: Lightbulb, render: TipsSection },
  ];
}

export default function HelpModal({ onClose, onStartTour }) {
  const sections = useMemo(() => buildHelpSections(firebaseEnabled), []);
  const [activeId, setActiveId] = useState(sections[0].id);

  const activeIndex = Math.max(0, sections.findIndex((s) => s.id === activeId));
  const active = sections[activeIndex];
  const ActiveBody = active.render;
  const isLast = activeIndex === sections.length - 1;

  const goTo = (index) => setActiveId(sections[index].id);

  return (
    <Modal
      zIndex={60}
      scrimClass="fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-fade-in"
      cardClass="w-full max-w-4xl bg-surface rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col h-[88vh] animate-scale-in"
      cardProps={{ role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title' }}
    >
      {/* Header bar */}
      <div className="shrink-0 px-6 sm:px-8 py-5 border-b border-slate-200/80 flex items-center justify-between gap-4 bg-slate-50/60">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 shrink-0 brand-gradient rounded-2xl flex items-center justify-center text-white shadow-xs shadow-indigo-500/25 ring-1 ring-indigo-500/20 dark:shadow-none dark:ring-white/20">
            <CircleHelp size={20} className="drop-shadow-xs" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="help-title" className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              How AppBlips works
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Build an app, refine it, and share it.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-200/70 transition-colors shrink-0"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div className="shrink-0 flex items-center justify-between gap-3 px-6 sm:px-8 py-3 border-b border-slate-200 bg-indigo-50">
        <p className="text-xs text-slate-600">Prefer a walkthrough?</p>
        <button type="button" onClick={onStartTour} className="tour-button brand-fill-text bg-brand text-white hover:bg-brand-hover"><Play size={14} aria-hidden="true" /> Start guided tour</button>
      </div>

      {/* Section rail -- phones: a horizontally scrolling chip strip */}
      <div className="md:hidden shrink-0 border-b border-slate-200/80 bg-slate-50/60 px-4 py-2.5 overflow-x-auto custom-scrollbar">
        <div className="nav-segmented-group nav-segmented-compact w-max" role="tablist" aria-label="Help sections">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              id={`help-mtab-${section.id}`}
              aria-selected={activeId === section.id}
              aria-controls={`help-panel-${section.id}`}
              onClick={() => setActiveId(section.id)}
              className={`nav-segmented-btn ${activeId === section.id ? 'nav-segmented-btn-active' : ''}`}
            >
              <section.Icon size={13} aria-hidden="true" />
              <span>{section.shortLabel}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Body: rail + panel */}
      <div className="flex-1 min-h-0 flex">
        <nav
          role="tablist"
          aria-label="Help sections"
          className="hidden md:flex w-56 lg:w-60 shrink-0 flex-col gap-1 border-r border-slate-200/80 bg-slate-50/60 p-3 overflow-y-auto custom-scrollbar"
        >
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              id={`help-tab-${section.id}`}
              aria-selected={activeId === section.id}
              aria-controls={`help-panel-${section.id}`}
              onClick={() => setActiveId(section.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-sm font-semibold transition-colors ${
                activeId === section.id
                  ? 'bg-surface text-indigo-700 border border-indigo-200 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
              }`}
            >
              <section.Icon
                size={15}
                className={activeId === section.id ? 'text-indigo-600' : 'text-slate-400'}
                aria-hidden="true"
              />
              <span className="truncate">{section.label}</span>
            </button>
          ))}
        </nav>

        {/* key={activeId} remounts the panel, which resets its scroll to the top
            and replays the fade-in -- no effect or ref needed. */}
        <div
          key={activeId}
          id={`help-panel-${activeId}`}
          role="tabpanel"
          aria-labelledby={`help-tab-${activeId}`}
          tabIndex={-1}
          className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-6 sm:p-8 bg-slate-50/40 animate-fade-in"
        >
          <ActiveBody />
        </div>
      </div>

      {/* Footer: read the guide straight through, or just close it */}
      <div className="shrink-0 bg-slate-50/90 border-t border-slate-200/80 px-6 sm:px-8 py-4 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span className="font-medium hidden sm:inline">
          Section <span className="font-bold text-slate-700">{activeIndex + 1}</span> of{' '}
          <span className="font-bold text-slate-700">{sections.length}</span>
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={() => goTo(activeIndex - 1)}
            disabled={activeIndex === 0}
            className="nav-btn bg-surface hover:bg-slate-100 text-slate-700 hover:text-slate-900 font-semibold px-3.5 py-1.5 rounded-xl border border-slate-200 shadow-2xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} />
            Back
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={onClose}
              className="brand-fill-text rounded-xl px-5 py-1.5 bg-brand text-white font-semibold text-xs hover:bg-brand-hover shadow-sm transition-colors active:scale-[0.98]"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(activeIndex + 1)}
              className="brand-fill-text inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 bg-brand text-white font-semibold text-xs hover:bg-brand-hover shadow-sm transition-colors active:scale-[0.98]"
            >
              Next
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
