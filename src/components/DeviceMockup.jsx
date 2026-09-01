import { Sparkles, Zap, ShieldAlert, Layers } from 'lucide-react';
import { PREVIEW_MODES } from '../lib/constants';
import { getEffectivePreviewBox } from '../lib/helpers';

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
          <div className="device-desktop-toolbar">
            <div className="device-desktop-lights">
              <span className="device-desktop-light device-desktop-light-red"></span>
              <span className="device-desktop-light device-desktop-light-amber"></span>
              <span className="device-desktop-light device-desktop-light-green"></span>
            </div>
            <div className="device-desktop-addressbar">
              <span className="device-desktop-address-pill"></span>
              <span className="device-desktop-address-text">app-preview.local</span>
            </div>
          </div>
        )}

        {/* Screen */}
        <div className={PREVIEW_MODES[mode].isTouchChrome ? 'device-screen device-screen-mobile' : 'device-screen'}>
          <div className={PREVIEW_MODES[mode].isTouchChrome ? 'device-preview-surface device-preview-surface-mobile' : 'device-preview-surface'}>
            {hasCode ? (
              <iframe
                ref={iframeRef}
                title="Generated App Preview"
                srcDoc={srcDoc}
                className="w-full h-full border-none"
                sandbox="allow-scripts allow-forms allow-popups"
                referrerPolicy="no-referrer"
                allow=""
              />
            ) : (
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

                <div className="flex flex-col gap-2 w-full max-w-[260px] sm:max-w-[280px]">
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs text-xs sm:text-sm font-medium text-slate-700">
                    <Zap size={14} className="text-amber-500 shrink-0" />
                    <span>Instant live rendering</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs text-xs sm:text-sm font-medium text-slate-700">
                    <ShieldAlert size={14} className="text-emerald-500 shrink-0" />
                    <span>Sandboxed origin security</span>
                  </div>
                  <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs text-xs sm:text-sm font-medium text-slate-700">
                    <Layers size={14} className="text-indigo-500 shrink-0" />
                    <span>Tailwind CSS & JS built-in</span>
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
              <p className="text-xs sm:text-sm text-slate-500 animate-pulse">Generating HTML, CSS & JavaScript</p>
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
        ) : (
          <div className="device-desktop-stand"></div>
        )}
      </div>
    </div>
  );
}
