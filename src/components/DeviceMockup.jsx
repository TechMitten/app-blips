import { useEffect, useState } from 'react';
import {
  Sparkles, Zap, ShieldAlert, Layers, ChevronLeft, ChevronRight, RotateCw,
  Lock, Star, Plus, X, MoreVertical, Wrench
} from 'lucide-react';
import previewIcon from '../assets/preview-icon.png';
import { PREVIEW_MODES } from '../lib/constants';
import { getEffectivePreviewBox } from '../lib/helpers';

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

// Scaled device mockup (phone/tablet/desktop chrome) wrapping the sandboxed
// preview iframe. The srcDoc fed here is the bridge-injected document computed
// at render time in App -- never `generatedCode` itself.
export default function DeviceMockup({
  mode,
  orientation,
  flipClass,
  onFlipAnimationEnd,
  zoomLevel,
  iframeRef,
  srcDoc,
  isGenerating,
  generationStatus,
  hasCode,
  isAutoFixing = false,
  autoFixMessage = null,
  isTransitioning = false,
  onCancelGeneration,
}) {
  const box = getEffectivePreviewBox(mode, orientation);
  const isSyntaxErrorAutoFix = Boolean(
    generationStatus?.toLowerCase().includes('syntax') ||
    autoFixMessage?.toLowerCase().includes('syntax')
  );
  const isErrorAutoFix = isAutoFixing || Boolean(
    generationStatus?.toLowerCase().includes('runtime error') ||
    generationStatus?.toLowerCase().includes('syntax error')
  );
  const displayAutoFixMessage = autoFixMessage || (
    generationStatus?.toLowerCase().includes('runtime error:')
      ? generationStatus.split(/runtime error:\s*/i)[1]
      : generationStatus?.toLowerCase().includes('syntax error:')
        ? generationStatus.split(/syntax error:\s*/i)[1]
        : null
  );

  return (
    <div
      className="palette-stock relative shrink-0 flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{
        width: box.width * zoomLevel,
        height: box.height * zoomLevel
      }}
    >
      <div
        className={`${PREVIEW_MODES[mode].deviceClass}${PREVIEW_MODES[mode].isTouchChrome && orientation === 'landscape' ? ' device-landscape' : ''}${flipClass ? ` ${flipClass}` : ''} transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]`}
        style={{ '--preview-zoom': zoomLevel }}
        onAnimationEnd={onFlipAnimationEnd}
      >
        <div 
          className={`device-browser-chrome transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${mode === 'desktop' ? 'h-[91px] opacity-100' : 'h-0 opacity-0'}`} 
          aria-hidden="true"
        >
            <div className="device-browser-tabstrip">
              <div className="device-desktop-lights">
                <span className="device-desktop-light device-desktop-light-red"></span>
                <span className="device-desktop-light device-desktop-light-amber"></span>
                <span className="device-desktop-light device-desktop-light-green"></span>
              </div>
              <div className="device-browser-tab">
                <span className="device-browser-favicon">
                  <Sparkles size={10} strokeWidth={2.5} />
                </span>
                <span className="device-browser-tab-title">app-preview.local</span>
                <X size={12} strokeWidth={2.25} className="device-browser-tab-close" />
              </div>
              <span className="device-browser-newtab">
                <Plus size={14} strokeWidth={2.25} />
              </span>
            </div>
            <div className="device-browser-toolbar">
              <div className="device-browser-nav">
                <span className="device-browser-navbtn is-disabled">
                  <ChevronLeft size={17} />
                </span>
                <span className="device-browser-navbtn is-disabled">
                  <ChevronRight size={17} />
                </span>
                <span className="device-browser-navbtn">
                  <RotateCw size={14} />
                </span>
              </div>
              <div className="device-browser-addressbar">
                <Lock size={12} strokeWidth={2.25} className="device-browser-lock" />
                <span className="device-browser-url">app-preview.local</span>
                <Star size={13} strokeWidth={2} className="device-browser-star" />
              </div>
              <div className="device-browser-actions">
                <span className="device-browser-navbtn">
                  <MoreVertical size={16} />
                </span>
                <span className="device-browser-avatar">O</span>
              </div>
            </div>
          </div>
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
              title="Generated App Preview"
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

                <div 
                  className="relative z-10 flex flex-col items-center transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ transform: `scale(${mode === 'desktop' ? 1.75 : mode === 'tablet' ? 1.35 : 1})` }}
                >
                  <div className="relative mb-3">
                    <img
                      src={previewIcon}
                      alt="App preview"
                      className="preview-empty-icon-img w-24 h-24 sm:w-28 sm:h-28 object-contain select-none"
                      draggable={false}
                    />
                  </div>

                  <h4 className="preview-empty-title text-base sm:text-lg font-bold tracking-tight mb-1.5">
                    Live Sandbox Preview
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
            <div className={`building-overlay absolute inset-0 flex flex-col items-center justify-center bg-white/95 backdrop-blur-md z-10 p-6 text-center${isErrorAutoFix ? ' building-overlay-error' : ''}`}>
              <div 
                className="flex flex-col items-center transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ transform: `scale(${mode === 'desktop' ? 1.75 : mode === 'tablet' ? 1.35 : 1})` }}
              >
                <div className="building-spinner relative w-16 h-16 mb-6">
                  {isErrorAutoFix ? (
                    <>
                      <div className="building-spinner-track absolute inset-0 border-4 border-amber-100 rounded-full"></div>
                      <div className="building-spinner-ring absolute inset-0 border-4 border-amber-500 rounded-full border-t-transparent animate-spin"></div>
                      <Wrench className="building-spinner-glyph absolute inset-0 m-auto text-amber-600" size={22} />
                    </>
                  ) : (
                    <>
                      <div className="building-spinner-track absolute inset-0 border-4 border-blue-100 rounded-full"></div>
                      <div className="building-spinner-ring absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
                      <Sparkles className="building-spinner-glyph absolute inset-0 m-auto text-blue-500" size={22} />
                    </>
                  )}
                </div>
                <h3 className="building-title text-sm sm:text-base font-semibold text-slate-900 mb-1">
                  {isErrorAutoFix
                    ? (isSyntaxErrorAutoFix ? 'Auto-fixing syntax error...' : 'Auto-fixing runtime error...')
                    : generationStatus?.startsWith('Analyzing') 
                      ? 'Planning...'
                      : generationStatus?.includes('Syntax errors found') 
                        ? 'Fixing errors...' 
                        : 'Building...'}
                </h3>
                {isErrorAutoFix ? (
                  <div className="space-y-1.5 max-w-[260px] sm:max-w-[300px] animate-fade-in-up">
                    <p className="building-error-text text-xs sm:text-sm text-amber-700 font-medium">
                      {generationStatus && !generationStatus.startsWith('Fixing runtime error') && !generationStatus.startsWith('Auto-fixing') && generationStatus !== 'Synthesizing your app from your prompt.'
                        ? generationStatus
                        : isSyntaxErrorAutoFix
                          ? 'Detected syntax error in code. Automatically applying a fix...'
                          : 'Detected a runtime error in preview. Automatically applying a fix...'}
                    </p>
                    {displayAutoFixMessage && (
                      <p className="building-error-code text-[11px] font-mono text-slate-500 bg-slate-100/90 border border-slate-200/80 rounded-lg px-2.5 py-1 text-center truncate" title={displayAutoFixMessage}>
                        {displayAutoFixMessage}
                      </p>
                    )}
                  </div>
                ) : generationStatus?.includes('Syntax errors found') || generationStatus?.startsWith('Analyzing') ? (
                  <p className="building-status text-xs sm:text-sm text-slate-600 font-medium animate-fade-in-up">
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
                    aria-label="Cancel auto-fix"
                    title="Cancel auto-fix"
                  >
                    <X size={13} strokeWidth={2.75} aria-hidden="true" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>
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
