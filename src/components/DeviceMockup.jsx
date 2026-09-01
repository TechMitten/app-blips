import { useEffect, useState } from 'react';
import {
  Sparkles, Zap, ShieldAlert, Layers, ChevronLeft, ChevronRight, RotateCw,
  Lock, Star, Plus, X, MoreVertical
} from 'lucide-react';
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
    <p key={messageIndex} className="text-xs sm:text-sm text-slate-600 font-medium animate-fade-in-up">
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
  hasCode,
}) {
  const box = getEffectivePreviewBox(mode, orientation);

  return (
    <div
      className="palette-stock relative shrink-0 flex items-center justify-center"
      style={{
        width: box.width * zoomLevel,
        height: box.height * zoomLevel
      }}
    >
      <div
        className={`${PREVIEW_MODES[mode].deviceClass}${PREVIEW_MODES[mode].isTouchChrome && orientation === 'landscape' ? ' device-landscape' : ''}${flipClass ? ` ${flipClass}` : ''}`}
        style={{ '--preview-zoom': zoomLevel }}
        onAnimationEnd={onFlipAnimationEnd}
      >
        {mode === 'desktop' && (
          <div className="device-browser-chrome" aria-hidden="true">
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
        )}

        {/* Screen */}
        <div className={PREVIEW_MODES[mode].isTouchChrome ? 'device-screen device-screen-mobile' : 'device-screen'}>
          <div className={PREVIEW_MODES[mode].isTouchChrome ? 'device-preview-surface device-preview-surface-mobile' : 'device-preview-surface'}>
            {/* Always mounted (even before the first generation) so the very
                first real `srcDoc` assignment is an attribute update on an
                already-connected iframe, not a fresh element creation -- the
                same shape every later regeneration already goes through. */}
            <iframe
              ref={iframeRef}
              title="Generated App Preview"
              srcDoc={srcDoc}
              className={`w-full h-full border-none${hasCode ? '' : ' hidden'}`}
              sandbox="allow-scripts allow-forms allow-popups"
              referrerPolicy="no-referrer"
              allow=""
            />
            {!hasCode && (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100/70 p-6 sm:p-8 text-center select-none relative overflow-hidden">
                {/* Ambient glow */}
                <div className="absolute w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

                <div className="relative mb-5">
                  <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-white flex items-center justify-center shadow-premium-md border border-slate-200/80">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-100 flex items-center justify-center text-indigo-600">
                      <Sparkles size={24} className="animate-pulse" />
                    </div>
                  </div>
                </div>

                <h4 className="text-base sm:text-lg font-bold text-slate-800 tracking-tight mb-1.5">
                  Live Sandbox Preview
                </h4>
                <p className="text-xs sm:text-sm text-slate-500 max-w-[17rem] leading-relaxed mb-6">
                  Enter a prompt to generate and interact with your app in real-time.
                </p>

                <div className="flex flex-col gap-2 w-full max-w-[260px] sm:max-w-[300px]">
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs text-xs sm:text-sm font-medium text-slate-700">
                    <Zap size={14} className="text-amber-500 shrink-0" />
                    <span className="whitespace-nowrap">Instant live rendering</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs text-xs sm:text-sm font-medium text-slate-700">
                    <ShieldAlert size={14} className="text-emerald-500 shrink-0" />
                    <span className="whitespace-nowrap">Sandboxed origin security</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs text-xs sm:text-sm font-medium text-slate-700">
                    <Layers size={14} className="text-indigo-500 shrink-0" />
                    <span className="whitespace-nowrap">Tailwind CSS &amp; JS built-in</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          {isGenerating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-10 p-6 text-center">
              <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 border-4 border-blue-100 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
                <Sparkles className="absolute inset-0 m-auto text-blue-500" size={22} />
              </div>
              <h3 className="text-sm sm:text-base font-semibold text-slate-900 mb-1">Building...</h3>
              <BuildingStatusMessage />
            </div>
          )}
        </div>

        {PREVIEW_MODES[mode].isTouchChrome ? (
          orientation === 'landscape' ? (
            <>
              {/* Side Buttons Visuals (rotated to top/bottom edges) */}
              <div className="absolute -top-1 left-24 h-1 w-12 bg-slate-700 rounded-b-sm shadow-sm"></div>
              <div className="absolute -top-1 left-40 h-1 w-20 bg-slate-700 rounded-b-sm shadow-sm"></div>
              <div className="absolute -bottom-1 left-36 h-1 w-20 bg-slate-700 rounded-t-sm shadow-sm"></div>

              {/* Home Indicator (rotated to right edge) */}
              <div className="absolute right-3 inset-y-0 flex items-center justify-center z-20">
                <div className="h-32 w-1.5 rounded-full bg-slate-200/70"></div>
              </div>
            </>
          ) : (
            <>
              {/* Side Buttons Visuals */}
              <div className="absolute -left-1 top-24 w-1 h-12 bg-slate-700 rounded-r-sm shadow-sm"></div>
              <div className="absolute -left-1 top-40 w-1 h-20 bg-slate-700 rounded-r-sm shadow-sm"></div>
              <div className="absolute -right-1 top-36 w-1 h-20 bg-slate-700 rounded-l-sm shadow-sm"></div>

              {/* Home Indicator */}
              <div className="absolute bottom-3 inset-x-0 flex justify-center z-20">
                <div className="w-32 h-1.5 rounded-full bg-slate-200/70"></div>
              </div>
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
