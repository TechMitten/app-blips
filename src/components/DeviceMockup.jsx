import { memo, useEffect, useLayoutEffect, useState, useRef } from 'react';
import {
  Sparkles, Zap, ShieldAlert, Layers, X, Brain
} from 'lucide-react';
import ThinkingElapsed from './ThinkingElapsed';
import { PREVIEW_MODES } from '../lib/constants';
import { getEffectivePreviewBox, syntaxHighlightHtml } from '../lib/helpers';

const BUILDING_MESSAGES = [
  'Generating HTML, CSS & JavaScript',
  'Laying out the page structure',
  'Wiring up interactivity',
  'Sanding down rough edges',
  'Sweating the small details',
  'Tuning the visual rhythm',
  'Teaching pixels to behave',
  'Compiling good ideas into code',
  'Double-checking the logic',
  'Polishing the finishing touches',
  'Almost there',
  'Choosing a font that means it',
  'Aligning things to the grid',
  'Negotiating with the box model',
  'Convincing divs to cooperate',
  'Balancing whitespace and content',
  'Wiring buttons up to actions',
  'Making sure the buttons feel clickable',
  'Sketching the component tree',
  'Naming things (the hard part)',
  'Refactoring before you even see it',
  'Chasing down a stray semicolon',
  'Straightening out the layout',
  'Bringing the color palette together',
  'Adding a dash of motion',
  'Smoothing out transitions',
  'Making the empty states less empty',
  'Getting the spacing just right',
  'Running a few sanity checks',
  'Checking things at every screen size',
  'Making it feel snappy',
  'Optimizing for the first impression',
  'Untangling nested elements',
  'Giving hover states some personality',
  'Making sure nothing overlaps',
  'Reviewing the interaction flow',
  'Buffing up the finer details',
  'Assembling the moving parts',
  'Bringing the design to life',
  'Making pixels behave themselves',
  'Fitting the last few pieces together',
  'Proofreading the copy',
  'Verifying everything lines up',
  'Adding the finishing flourishes',
  'Making it production-worthy',
  'Wrapping up the last details',
  'Firming up the edge cases',
  'Reticulating splines',
  'Coaxing the CSS into place',
  'Bringing order to the markup',
  'Putting the final coat of polish on',
  'Drafting the first pass',
  'Sketching a rough layout',
  'Filling in the blanks',
  'Connecting the dots',
  'Turning ideas into markup',
  'Mapping out the user flow',
  'Setting up the scaffolding',
  'Framing the page',
  'Bringing structure to the chaos',
  'Shaping raw ideas into pixels',
  'Threading state through the app',
  'Hooking up the event handlers',
  'Making sure the state stays in sync',
  "Debugging before there's a bug",
  'Preemptively fixing edge cases',
  'Tidying up the DOM tree',
  'Flattening unnecessary nesting',
  'Trimming the excess',
  'Cutting out the clutter',
  'Simplifying where it counts',
  'Choosing colors that work together',
  'Picking a palette with intention',
  'Getting the contrast right',
  'Making text easy on the eyes',
  'Sizing things to feel right',
  'Adjusting the rhythm of the layout',
  'Lining up the details',
  'Squaring away the corners',
  'Rounding off rough edges',
  'Adding a little shadow depth',
  'Layering things just so',
  'Making the interface feel alive',
  'Bringing in some personality',
  'Sprinkling in delight',
  'Making sure it feels intuitive',
  'Testing the tap targets',
  'Making buttons big enough to tap',
  'Checking things work on mobile too',
  "Making sure text doesn't wrap awkwardly",
  'Keeping things responsive',
  'Stress-testing the layout',
  'Running through the happy path',
  'Accounting for the unhappy path',
  'Handling the tricky inputs',
  'Making forms feel friendly',
  'Validating as it goes',
  'Wiring up the finishing logic',
  'Cross-checking the details',
  'Buttoning things up',
  'Spinning up the build',
  'Warming up the compiler',
  'Sketching the wireframes',
  'Turning wireframes into reality',
  'Blocking out the sections',
  'Establishing a visual hierarchy',
  'Deciding what deserves emphasis',
  'Working out the information architecture',
  'Grouping related elements',
  'Giving related things room to breathe',
  'Drawing the eye where it matters',
  'Making the call-to-action stand out',
  'Making sure nothing competes for attention',
  'Balancing the composition',
  'Finding the right visual weight',
  'Choosing icons that fit',
  'Matching iconography to tone',
  'Picking type sizes that scale well',
  'Setting a comfortable line height',
  'Making paragraphs easy to scan',
  'Shortening walls of text',
  'Writing copy that gets to the point',
  'Making labels clearer',
  'Renaming things that were named in a hurry',
  'Sweeping up unused styles',
  'Deduplicating repeated markup',
  'Extracting a reusable pattern',
  'Consolidating similar components',
  'Keeping the markup semantic',
  'Adding the right ARIA labels',
  'Making sure screen readers are happy',
  'Testing with the keyboard only',
  'Making focus states visible',
  'Checking color contrast ratios',
  'Making sure links look like links',
  'Making sure buttons look like buttons',
  'Distinguishing primary from secondary actions',
  'Softening harsh transitions',
  'Easing the animation curves',
  'Timing the micro-interactions',
  'Adding subtle hover feedback',
  'Making loading states feel purposeful',
  'Designing a graceful empty state',
  'Handling the no-data case',
  'Writing a friendlier error message',
  'Catching edge cases before they catch you',
  'Guarding against bad input',
  'Sanitizing what needs sanitizing',
  'Making sure numbers format correctly',
  'Getting the dates right',
  'Handling long text gracefully',
  'Truncating where it makes sense',
  'Making images scale properly',
  'Keeping aspect ratios intact',
  'Compressing what can be compressed',
  'Trimming unnecessary weight',
  'Speeding up the first paint',
  'Deferring what can wait',
  'Loading the essentials first',
  'Making the app feel instant',
  'Smoothing out scroll behavior',
  'Getting the touch targets comfortable',
  'Making gestures feel natural',
  'Double-checking the tab order',
  'Making sure modals trap focus properly',
  "Closing dialogs the way you'd expect",
  'Making dropdowns behave',
  'Getting z-index sorted out',
  'Untangling overlapping layers',
  'Making sure nothing clips awkwardly',
  'Fixing an off-by-one pixel',
  'Nudging things into alignment',
  'Centering what should be centered',
  'Making margins consistent',
  'Standardizing the spacing scale',
  'Applying the design tokens',
  'Keeping the styles consistent',
  'Reconciling light and dark mode',
  'Making sure both themes look intentional',
  'Checking contrast in both themes',
  'Verifying the color tokens carry through',
  'Giving the UI a final gut check',
  'Comparing against the original idea',
  'Making sure it matches the vision',
  'Adding a bit of visual flair',
  'Keeping the flair tasteful',
  'Resisting the urge to overdesign',
  'Knowing when to stop tweaking',
  'Running one more pass',
  'Reviewing with fresh eyes',
  'Catching what was missed the first time',
  'Making sure everything still works together',
  'Bringing it all together',
  'Getting close to done',
  'Wrapping things up nicely',
  'Putting on the finishing touches',
  'Getting ready to ship',
  'Squaring the last few loose ends',
  'Making one final pass',
  'Sealing up the details',
];

function pickNextIndex(previousIndex) {
  if (BUILDING_MESSAGES.length <= 1) return 0;
  let next = Math.floor(Math.random() * BUILDING_MESSAGES.length);
  while (next === previousIndex) {
    next = Math.floor(Math.random() * BUILDING_MESSAGES.length);
  }
  return next;
}

// Mounted fresh each time the building overlay appears, so its message index
// naturally starts random without needing a reset effect.
function BuildingStatusMessage() {
  const [messageIndex, setMessageIndex] = useState(() => pickNextIndex(-1));

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => pickNextIndex(prev));
    }, 3400);
    return () => clearInterval(interval);
  }, []);

  return (
    <p key={messageIndex} className="building-status building-status-live text-xs sm:text-sm text-slate-600 font-medium animate-fade-in-up">
      {BUILDING_MESSAGES[messageIndex]}
    </p>
  );
}

// Small terminal-style window that follows the last few lines of code as the
// model writes them. Presentational only: it reads the stream text through a
// ref and never touches generatedCode. Network chunks arrive in bursts, so
// rather than rendering them as they land it reveals the text on animation
// frames at a steady pace that speeds up in proportion to the backlog -- it
// types, rather than flickers.
// Most lines kept from the stream: enough to fill the tall mobile/tablet card
// (up to 420px, about 19 lines). How many are shown is measured from the
// card (see `capacity` in LiveCodePeek); the compact desktop card shows
// COMPACT_PEEK_LINES and stays content-sized up to that.
const PEEK_LINES = 22;
const COMPACT_PEEK_LINES = 12;
// Once the text has stopped growing (and the typing has caught up) for this
// long, the model is no longer writing code -- it is reviewing, summarizing or
// waiting -- so the peek steps aside until more code arrives.
const PEEK_IDLE_MS = 1500;

// One highlighted line. Memoized on its text so lines that have finished
// streaming are never touched again -- only the line being written re-renders.
const PeekLine = memo(function PeekLine({ text }) {
  // syntaxHighlightHtml returns '' for an empty string, which would render no
  // row at all; a blank line must still take one line of height, or the panel
  // shows a varying number of rows as blank lines scroll through it.
  return <span className="peek-line" dangerouslySetInnerHTML={{ __html: syntaxHighlightHtml(text || ' ') }} />;
});

function LiveCodePeek({ codeRef, page = null, streamDone = false, reasoning = '', compact = false, className = '' }) {
  const [view, setView] = useState({ start: 0, lines: [] });
  const [idle, setIdle] = useState(false);
  // Flips one frame after the first lines exist so the entrance transitions
  // from the hidden state instead of appearing already visible.
  const [entered, setEntered] = useState(false);
  const streamDoneRef = useRef(streamDone);
  useEffect(() => { streamDoneRef.current = streamDone; }, [streamDone]);
  const hasLines = view.lines.length > 0;
  // Lines that fit the tall card. Lines fill from the top until the card is
  // full, then the newest stays at the bottom and older ones scroll off. Plain
  // CSS can't do both (bottom-aligned leaves a gap above a short stream), so
  // the body shows exactly as many lines as fit.
  const bodyRef = useRef(null);
  const [measured, setMeasured] = useState(PEEK_LINES);
  const capacity = compact ? COMPACT_PEEK_LINES : measured;
  const shown = view.lines.length > capacity ? view.lines.slice(-capacity) : view.lines;
  const shownStart = view.start + view.lines.length - shown.length;
  const scrolledOff = shownStart > 0;
  // Keep the visible panel anchored to the newest thought. Without this, the
  // intentionally compact preview shows the beginning of a long reasoning
  // stream and then appears to stop while the text continues arriving.
  const visibleReasoning = reasoning.length > 600 ? `…${reasoning.slice(-600)}` : reasoning;

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || compact || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight);
      const inner = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (lineHeight > 0 && inner > 0) {
        setMeasured(Math.max(1, Math.min(PEEK_LINES, Math.floor(inner / lineHeight))));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasLines, compact]);

  useEffect(() => {
    if (!hasLines) return undefined;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [hasLines]);

  useEffect(() => {
    let raf = 0;
    let cursor = 0;
    let lastKey = '';
    let lastLength = 0;
    let lastActivity = performance.now();
    let isIdle = false;
    const setIdleState = (next) => {
      if (next !== isIdle) {
        isIdle = next;
        setIdle(next);
      }
    };
    const tick = () => {
      const text = codeRef?.current || '';
      const now = performance.now();
      if (text.length !== lastLength) {
        lastLength = text.length;
        lastActivity = now;
      }
      if (cursor > text.length) cursor = text.length;
      const backlog = text.length - cursor;
      if (backlog > 0 || !streamDoneRef.current || now - lastActivity < PEEK_IDLE_MS) setIdleState(false);
      else setIdleState(true);
      if (backlog > 1200) cursor = text.length - 1200; // don't replay a huge burst
      if (backlog > 0) {
        cursor += Math.min(backlog, Math.max(2, Math.ceil(backlog / 24)));
        const all = text.slice(0, cursor).split('\n');
        const start = Math.max(0, all.length - PEEK_LINES);
        const lines = all.slice(start).map((line) => line.slice(0, 240));
        const key = `${start}\u0000${lines.join('\n')}`;
        if (key !== lastKey) {
          lastKey = key;
          setView({ start, lines });
        }
      }
      // An empty ref mid-stream (edit-stream reset between attempts) keeps the
      // last frame on screen rather than unmounting and replaying the entrance.
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [codeRef]);

  if (!hasLines && !reasoning) return null;
  return (
    <div className={`live-code-peek w-[min(600px,92%)] text-left ${compact ? 'live-code-peek-compact' : ''} ${(reasoning || (entered && !idle)) ? 'is-visible' : ''} ${className}`}>
      <div className="live-code-peek-bar">
        <span className="live-code-peek-dot" />
        <span className="live-code-peek-label">generating code</span>
        {page?.page && <span key={page.page} className="live-code-peek-page">{page.page}</span>}
      </div>
      {hasLines && (
        <pre ref={bodyRef} className={`live-code-peek-body ${scrolledOff ? 'is-scrolled' : ''}`}>
          <code>
            {shown.map((line, i) => (
              <PeekLine key={shownStart + i} text={line} />
            ))}
          </code>
        </pre>
      )}
      {reasoning && (
        <div className="live-code-peek-reasoning" aria-label="Model reasoning">
          <span className="live-code-peek-reasoning-label">thinking</span>
          <span className="live-code-peek-reasoning-text"><span>{visibleReasoning}</span></span>
        </div>
      )}
      <div className="live-code-peek-footer">
        <span className="live-code-peek-activity" aria-hidden="true">
          <i /><i /><i /><i /><i /><i /><i /><i />
        </span>
        <span className="live-code-peek-footer-label">Writing code...</span>
      </div>
    </div>
  );
}

// Scaled device mockup (phone/tablet/desktop chrome) wrapping the sandboxed
// preview iframe. The srcDoc fed here is the bridge-injected document computed
// at render time in App -- never `generatedCode` itself.
function SystemClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const updateTime = () => setNow(new Date());
    const interval = window.setInterval(updateTime, 1000);
    window.addEventListener('focus', updateTime);
    document.addEventListener('visibilitychange', updateTime);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', updateTime);
      document.removeEventListener('visibilitychange', updateTime);
    };
  }, []);

  return (
    <span className="building-device-time">
      {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
    </span>
  );
}

export default function DeviceMockup({
  mode,
  orientation,
  flipClass,
  onFlipAnimationEnd,
  zoomLevel,
  fillSize = null,
  isBareFill = false,
  iframeRef,
  srcDoc,
  browserToken,
  isBrowserTesting = false,
  isGenerating,
  generationStatus,
  thinkingSince = null,
  liveCodeRef = null,
  liveCodeStreamDone = false,
  liveCodePage = null,
  streamingReasoning = '',
  hasCode,
  isAutoFixing = false,
  isTransitioning = false,
  onCancelGeneration,
}) {
  const box = fillSize || getEffectivePreviewBox(mode, orientation);
  const isErrorAutoFix = !isBrowserTesting && (isAutoFixing || Boolean(
    generationStatus?.toLowerCase().includes('runtime error') ||
    generationStatus?.toLowerCase().includes('syntax error')
  ));
  // Reasoning is on and the model hasn't produced output yet.
  const isThinking = Boolean(thinkingSince) && !isErrorAutoFix;

  return (
    <div
      className="palette-stock device-stage relative shrink-0 flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{
        width: box.width * zoomLevel,
        height: box.height * zoomLevel
      }}
    >
      <div
        className={`device-embedded-browser ${PREVIEW_MODES[mode].deviceClass}${isBareFill ? ' device-bare' : ''}${PREVIEW_MODES[mode].isTouchChrome && orientation === 'landscape' ? ' device-landscape' : ''}${flipClass ? ` ${flipClass}` : ''} transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]`}
        style={{
          '--preview-zoom': zoomLevel,
          ...(fillSize ? { width: fillSize.width, height: fillSize.height } : null)
        }}
        onAnimationEnd={onFlipAnimationEnd}
      >
        {/* Screen */}
        <div className={`${PREVIEW_MODES[mode].isTouchChrome ? 'device-screen device-screen-mobile' : 'device-screen'} transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]`}>
          <div className={`${PREVIEW_MODES[mode].isTouchChrome ? 'device-preview-surface device-preview-surface-mobile' : 'device-preview-surface'} transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]`}>
            {/* Always mounted (even before the first generation) so the very
                first real `srcDoc` assignment is an attribute update on an
                already-connected iframe, not a fresh element creation -- the
                same shape every later regeneration already goes through.

                It is also never `display: none`. The empty-state card below is
                an overlay painted ON TOP of it rather than a replacement for
                it, because hiding the iframe would mean the first real
                `srcDoc` lands on a frame that has never been rendered -- the
                document navigates and the frame gets its first layout in the
                same commit, and Chromium then routinely leaves that frame's
                compositor surface blank (white) until something forces it to
                recomposite. That is the "white until I toggle Code/Preview or
                switch device" bug: both of those force a fresh element or a
                relayout. Keeping the frame laid out at all times means a new
                document always commits into an already-rendering frame. */}
            <iframe
              ref={iframeRef}
              title="AppBlips Browser"
              data-appblips-browser="true"
              data-browser-token={browserToken}
              srcDoc={srcDoc}
              className={`w-full h-full border-none ${isTransitioning ? 'overflow-hidden pointer-events-none' : ''}`}
              scrolling={isTransitioning ? 'no' : 'auto'}
              sandbox="allow-scripts allow-forms allow-popups"
              referrerPolicy="no-referrer"
              allow=""
            />
            {!hasCode && (
              <div className="preview-empty-backdrop absolute inset-0 flex flex-col items-center justify-center p-6 sm:p-8 text-center select-none overflow-hidden">
                {/* Ambient glow */}
                <div className="preview-empty-glow absolute inset-0 pointer-events-none" />

                <div className="relative z-10 flex flex-col items-center transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]">
                  {/* Two lockups, one visible per theme: the light PNG has dark
                      lettering that would vanish on the dark screen. */}
                  <div className="preview-empty-logo relative mb-4 w-64 sm:w-80">
                    <img
                      src="/AppBlips-compressed.png"
                      alt="AppBlips"
                      className="preview-empty-logo-img preview-empty-logo-light select-none"
                      draggable={false}
                    />
                    <img
                      src="/darkthemelog.png"
                      alt=""
                      aria-hidden="true"
                      className="preview-empty-logo-img preview-empty-logo-dark select-none"
                      draggable={false}
                    />
                  </div>

                  <h4 className="preview-empty-title text-base sm:text-lg font-bold tracking-tight mb-1.5">
                    Live Browser
                  </h4>
                  <p className="preview-empty-subtitle text-xs sm:text-sm max-w-[17rem] leading-relaxed mb-6">
                    Enter a prompt to generate and interact with your app in real-time.
                  </p>

                  <div className="flex flex-col gap-2 w-full max-w-[260px] sm:max-w-[300px]">
                    <div className="preview-empty-pill flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium">
                      <Zap size={14} className="text-amber-500 shrink-0" />
                      <span className="whitespace-nowrap">Instant live rendering</span>
                    </div>
                    <div className="preview-empty-pill flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium">
                      <ShieldAlert size={14} className="text-emerald-500 shrink-0" />
                      <span className="whitespace-nowrap">Sandboxed origin security</span>
                    </div>
                    <div className="preview-empty-pill flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium">
                      <Layers size={14} className="text-indigo-500 shrink-0" />
                      <span className="whitespace-nowrap">Tailwind CSS &amp; JS built-in</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          {(isGenerating || isErrorAutoFix) && (
            <div className="building-overlay absolute inset-0 flex flex-col items-center justify-center z-10 p-6 text-center">
              <div className="building-device-status" aria-hidden="true">
                <SystemClock />
                <span className="building-device-icons">
                  <span className="building-signal"><i /><i /><i /><i /></span>
                  <span className="building-wifi"><i /><i /></span>
                  <span className="building-battery"><i /></span>
                </span>
              </div>
              {mode !== 'desktop' && (
                <div className="building-device-notch" aria-hidden="true"><span /></div>
              )}
              <div className="building-main flex flex-col items-center transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]">
                <div className="building-spinner relative w-16 h-16 mb-6">
                  <div className="building-spinner-track absolute inset-0 border-4 border-blue-100 rounded-full"></div>
                  <div className="building-spinner-ring absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
                  {isThinking ? (
                    <Brain className="building-spinner-glyph absolute inset-0 m-auto text-blue-500 animate-pulse" size={22} />
                  ) : (
                    <Sparkles className="building-spinner-glyph absolute inset-0 m-auto text-blue-500" size={22} />
                  )}
                </div>
                <h3 className="building-title text-sm sm:text-base font-semibold text-slate-900 mb-1">
                  {isErrorAutoFix || generationStatus?.includes('Syntax errors found')
                    ? 'Auto Error Checking'
                    : isThinking
                      ? 'Thinking...'
                    : generationStatus?.startsWith('Analyzing') 
                      ? 'Planning...'
                      : 'Building...'}
                </h3>
                {isThinking ? (
                  <>
                    <p role="status" className="building-status building-status-live text-xs sm:text-sm text-slate-600 font-medium animate-fade-in-up">
                      Reasoning through your request
                    </p>
                    <span className="building-progress-dots" aria-hidden="true"><i /><i /><i /></span>
                    <p className="building-remaining"><ThinkingElapsed since={thinkingSince} /> elapsed</p>
                  </>
                ) : isErrorAutoFix || generationStatus?.includes('Syntax errors found') || generationStatus?.startsWith('Analyzing') ? (
                  <p className="building-status text-xs sm:text-sm text-slate-600 font-medium animate-fade-in-up">
                    {generationStatus && !generationStatus.toLowerCase().includes('error') && generationStatus !== 'Synthesizing your app from your prompt.'
                      ? generationStatus
                      : 'Verifying code...'}
                  </p>
                ) : generationStatus && generationStatus !== 'Synthesizing your app from your prompt.' ? (
                  <p key={generationStatus} className="building-status building-status-live text-xs sm:text-sm text-slate-600 font-medium animate-fade-in-up">
                    {generationStatus}
                  </p>
                ) : (
                  <BuildingStatusMessage />
                )}
                {/* Auto-fix can run past the chat panel's cancel control -- it
                    stays active through the preview settlement window, and the
                    panel is hidden on mobile once the preview takes over. Give
                    the overlay its own stop control so a repair loop is always
                    escapable. */}
                {isErrorAutoFix && onCancelGeneration && (
                  <button
                    type="button"
                    onClick={onCancelGeneration}
                    className="building-cancel mt-5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all"
                    aria-label="Cancel"
                    title="Cancel"
                  >
                    <X size={13} strokeWidth={2.75} aria-hidden="true" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>
              {(isGenerating || isErrorAutoFix) && liveCodeRef && (
                <LiveCodePeek codeRef={liveCodeRef} streamDone={liveCodeStreamDone} page={liveCodePage} reasoning={streamingReasoning} compact={mode === 'desktop'} className="mt-6" />
              )}
            </div>
          )}
        </div>

        {mode === 'mobile' ? (
          orientation === 'landscape' ? (
            <>
              {/* Speaker slit & Front camera & Sensor */}
              <div className="device-speaker-slit-landscape animate-fade-in" aria-hidden="true" />
              <div className="device-front-camera-landscape animate-fade-in" aria-hidden="true" />
              <div className="device-sensor-dot-landscape animate-fade-in" aria-hidden="true" />

              {/* Antenna bands */}
              <div className="device-antenna device-antenna-h -top-[2.5px] left-[68px]" aria-hidden="true" />
              <div className="device-antenna device-antenna-h -top-[2.5px] right-[68px]" aria-hidden="true" />
              <div className="device-antenna device-antenna-h -bottom-[2.5px] left-[68px]" aria-hidden="true" />
              <div className="device-antenna device-antenna-h -bottom-[2.5px] right-[68px]" aria-hidden="true" />

              {/* Hardware buttons */}
              <div className="device-hw-btn-landscape -top-[3px] left-[80px] h-[3px] w-6 rounded-t-[2px] animate-fade-in" aria-hidden="true" />
              <div className="device-hw-btn-landscape -top-[3px] left-[118px] h-[3px] w-11 rounded-t-[2px] animate-fade-in" aria-hidden="true" />
              <div className="device-hw-btn-landscape -top-[3px] left-[172px] h-[3px] w-11 rounded-t-[2px] animate-fade-in" aria-hidden="true" />
              <div className="device-hw-btn-landscape -bottom-[3px] left-[130px] h-[3px] w-16 rounded-b-[2px] animate-fade-in" aria-hidden="true" />

              {/* Home Indicator (right bezel) */}
              <div className="absolute right-[9px] inset-y-0 flex items-center justify-center z-20 pointer-events-none animate-fade-in">
                <div className="device-home-indicator-bar-landscape"></div>
              </div>
            </>
          ) : (
            <>
              {/* Speaker slit & Front camera & Sensor */}
              <div className="device-speaker-slit animate-fade-in" aria-hidden="true" />
              <div className="device-front-camera animate-fade-in" aria-hidden="true" />
              <div className="device-sensor-dot animate-fade-in" aria-hidden="true" />

              {/* Antenna bands */}
              <div className="device-antenna device-antenna-v -left-[2.5px] top-[68px]" aria-hidden="true" />
              <div className="device-antenna device-antenna-v -left-[2.5px] bottom-[68px]" aria-hidden="true" />
              <div className="device-antenna device-antenna-v -right-[2.5px] top-[68px]" aria-hidden="true" />
              <div className="device-antenna device-antenna-v -right-[2.5px] bottom-[68px]" aria-hidden="true" />

              {/* Hardware buttons */}
              <div className="device-hw-btn -left-[3px] top-[80px] w-[3px] h-6 rounded-l-[2px] animate-fade-in" aria-hidden="true" />
              <div className="device-hw-btn -left-[3px] top-[118px] w-[3px] h-11 rounded-l-[2px] animate-fade-in" aria-hidden="true" />
              <div className="device-hw-btn -left-[3px] top-[172px] w-[3px] h-11 rounded-l-[2px] animate-fade-in" aria-hidden="true" />
              <div className="device-hw-btn -right-[3px] top-[130px] w-[3px] h-16 rounded-r-[2px] animate-fade-in" aria-hidden="true" />

              {/* Home Indicator (bottom bezel) */}
              <div className="absolute bottom-[9px] inset-x-0 flex justify-center z-20 pointer-events-none animate-fade-in">
                <div className="device-home-indicator-bar"></div>
              </div>
            </>
          )
        ) : mode === 'tablet' ? (
          orientation === 'landscape' ? (
            <>
              {/* Side Buttons Visuals (rotated to top/bottom edges) */}
              <div className="absolute -top-1 left-24 h-1 w-12 bg-slate-700 rounded-b-sm shadow-sm animate-fade-in"></div>
              <div className="absolute -top-1 left-40 h-1 w-20 bg-slate-700 rounded-b-sm shadow-sm animate-fade-in"></div>
              <div className="absolute -bottom-1 left-36 h-1 w-20 bg-slate-700 rounded-t-sm shadow-sm animate-fade-in"></div>

              {/* Home Indicator (rotated to right edge) */}
              <div className="absolute right-2 inset-y-0 flex items-center justify-center z-20 pointer-events-none animate-fade-in">
                <div className="h-32 w-1.5 rounded-full bg-slate-200/70"></div>
              </div>
            </>
          ) : (
            <>
              {/* Side Buttons Visuals */}
              <div className="absolute -left-1 top-24 w-1 h-12 bg-slate-700 rounded-r-sm shadow-sm animate-fade-in"></div>
              <div className="absolute -left-1 top-40 w-1 h-20 bg-slate-700 rounded-r-sm shadow-sm animate-fade-in"></div>
              <div className="absolute -right-1 top-36 w-1 h-20 bg-slate-700 rounded-l-sm shadow-sm animate-fade-in"></div>

              {/* Home Indicator */}
              <div className="absolute bottom-2 inset-x-0 flex justify-center z-20 pointer-events-none animate-fade-in">
                <div className="w-32 h-1.5 rounded-full bg-slate-200/70"></div>
              </div>
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
