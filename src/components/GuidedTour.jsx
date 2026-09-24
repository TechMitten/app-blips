import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, ArrowRight, Check, Compass, FolderOpen, History, Menu, MessageSquarePlus, MonitorSmartphone,
  MousePointerClick, PartyPopper, Play, Repeat2, Share2, Sparkles, X,
} from 'lucide-react';
import { buildTourSteps, getTourState, setTourState } from '../lib/tourSteps';
import useTourGeometry from '../hooks/useTourGeometry';

const STEP_ICONS = {
  idea: Sparkles, modes: Repeat2, preview: Play, devices: MonitorSmartphone, edit: MousePointerClick,
  history: History, share: Share2, chats: MessageSquarePlus, apps: FolderOpen, finish: PartyPopper, menu: Menu,
};

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

// First-visit offer. Floats over the workspace instead of pushing it down, and
// never returns once the tour has been started, finished, or dismissed.
export function TourInvitation({ onStart }) {
  const [visible, setVisible] = useState(() => getTourState() == null);
  if (!visible) return null;
  const dismiss = () => { setVisible(false); setTourState('dismissed'); };
  return (
    <aside className="tour-invite bg-surface text-slate-900" aria-label="Welcome to AppBlips">
      <span className="tour-invite-icon" aria-hidden="true"><Compass size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">New here?</p>
        <p className="text-xs text-slate-600 mt-0.5">Take a one-minute tour of your workspace.</p>
      </div>
      <button type="button" onClick={() => { dismiss(); onStart(); }} className="tour-button tour-button-primary bg-brand brand-fill-text text-white hover:bg-brand-hover">
        Start tour
      </button>
      <button type="button" onClick={dismiss} className="tour-close text-slate-500 hover:bg-slate-100" aria-label="Dismiss tour invitation"><X size={16} /></button>
    </aside>
  );
}

export default function GuidedTour({ onClose, onViewChange, firebaseEnabled, hasCode, showCodeView, studioMode }) {
  const wideScreen = useMediaQuery('(min-width: 1024px)');
  const steps = useMemo(
    () => buildTourSteps({ wideScreen, firebaseEnabled, hasCode, showCodeView, studioMode }),
    [wideScreen, firebaseEnabled, hasCode, showCodeView, studioMode],
  );
  const [index, setIndex] = useState(0);
  // Crossing the breakpoint changes the step count; never point past the end.
  const safeIndex = Math.min(index, steps.length - 1);
  const step = steps[safeIndex];
  const last = safeIndex === steps.length - 1;
  const cardRef = useRef(null);
  const [shaking, setShaking] = useState(false);

  useLayoutEffect(() => {
    if (step.view) onViewChange(step.view);
  }, [step.view, onViewChange]);

  const geometry = useTourGeometry({ targets: step.target, placement: step.placement, cardRef, stepKey: step.id });

  // The workspace goes inert so nothing behind the scrim is reachable; focus
  // returns to whatever launched the tour (or a sensible header control).
  useEffect(() => {
    const root = document.getElementById('root');
    const previousInert = root?.inert;
    const previousFocus = document.activeElement;
    if (root) root.inert = true;
    return () => {
      if (root) root.inert = previousInert;
      const menu = document.querySelector('[data-tour="menu"]');
      const fallback = menu?.getBoundingClientRect().width ? menu : document.querySelector('[data-tour="help"]');
      const restore = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : fallback;
      restore?.focus({ preventScroll: true });
    };
  }, []);

  // The card is visibility:hidden until the first measure, and a hidden
  // element can't take focus -- so focus once geometry exists, not on mount.
  const measured = Boolean(geometry);
  useEffect(() => {
    if (measured) cardRef.current?.focus({ preventScroll: true });
  }, [measured]);

  const finish = () => { setTourState('completed'); onClose(); };
  const skip = () => { setTourState('dismissed'); onClose(); };
  const go = (next) => setIndex(Math.max(0, Math.min(steps.length - 1, next)));

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); skip(); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); if (last) finish(); else go(safeIndex + 1); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(safeIndex - 1); return; }
    if (event.key === 'Tab') {
      const buttons = [...cardRef.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0];
      const lastButton = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
        event.preventDefault(); lastButton.focus();
      } else if (!event.shiftKey && (document.activeElement === lastButton || document.activeElement === cardRef.current)) {
        event.preventDefault(); first.focus();
      }
    }
  };

  // A stray tap on the scrim nudges the card rather than ending the tour.
  const nudge = () => {
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
    cardRef.current?.focus();
  };

  const Icon = STEP_ICONS[step.icon] || Compass;
  const target = geometry?.target;
  const cardStyle = !geometry
    ? { visibility: 'hidden' }
    : geometry.sheet
      ? { maxHeight: geometry.maxHeight }
      : { left: geometry.left, top: geometry.top, width: geometry.width, maxHeight: geometry.maxHeight };
  const arrowStyle = geometry?.arrow == null ? null
    : geometry.placement === 'top' || geometry.placement === 'bottom'
      ? { left: geometry.arrow }
      : { top: geometry.arrow };

  return createPortal(
    <div className="tour-layer" onKeyDown={handleKeyDown}>
      <div className="tour-hitbox" aria-hidden="true" onClick={nudge} />
      <div
        aria-hidden="true"
        className={`tour-spotlight ${target ? '' : 'tour-spotlight-empty'}`}
        style={target ? { left: target.left, top: target.top, width: target.width, height: target.height } : undefined}
      />
      <section
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        data-placement={geometry?.placement}
        className={`tour-card bg-surface text-slate-900 ${geometry?.sheet ? 'tour-card-sheet' : ''} ${shaking ? 'tour-card-shake' : ''}`}
        style={cardStyle}
        onAnimationEnd={(event) => { if (event.animationName === 'tour-shake') setShaking(false); }}
      >
        {arrowStyle && <span className="tour-arrow bg-surface" style={arrowStyle} aria-hidden="true" />}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-500 tabular-nums" aria-hidden="true">
            {safeIndex + 1} <span className="text-slate-400">/ {steps.length}</span>
          </span>
          <button type="button" onClick={skip} aria-label="Close tour" className="tour-close text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div key={step.id} className="tour-step-body" aria-live="polite" aria-atomic="true">
          <div className="flex items-start gap-3 mt-1">
            <span className="tour-step-icon" aria-hidden="true"><Icon size={18} /></span>
            <div className="min-w-0">
              <p className="sr-only">Step {safeIndex + 1} of {steps.length}</p>
              <h2 id="tour-title" className="text-base font-bold leading-snug pt-1.5">{step.title}</h2>
            </div>
          </div>
          <p id="tour-description" className="text-sm text-slate-600 leading-relaxed mt-3">{step.body}</p>
          {step.tips && (
            <ul className="tour-tips mt-3">
              {step.tips.map(tip => <li key={tip}>{tip}</li>)}
            </ul>
          )}
        </div>

        <div className="tour-dots mt-5" role="group" aria-label="Tour steps">
          {steps.map((item, i) => (
            <button
              type="button"
              key={item.id}
              aria-label={`Go to step ${i + 1}: ${item.title}`}
              aria-current={i === safeIndex ? 'step' : undefined}
              className="tour-dot"
              onClick={() => go(i)}
            >
              <span className={i === safeIndex ? 'tour-dot-mark is-active' : i < safeIndex ? 'tour-dot-mark is-done' : 'tour-dot-mark'} />
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 mt-3">
          <button type="button" className="tour-button text-slate-500 hover:bg-slate-100" onClick={skip}>Skip</button>
          <div className="flex gap-2">
            {safeIndex > 0 && (
              <button type="button" className="tour-button text-slate-700 hover:bg-slate-100" onClick={() => go(safeIndex - 1)}>
                <ArrowLeft size={14} /> Back
              </button>
            )}
            <button type="button" className="tour-button tour-button-primary bg-brand brand-fill-text text-white hover:bg-brand-hover" onClick={() => (last ? finish() : go(safeIndex + 1))}>
              {last ? 'Finish' : 'Next'}{last ? <Check size={14} /> : <ArrowRight size={14} />}
            </button>
          </div>
        </div>
        <p className="tour-kbd-hint text-[11px] text-slate-400 mt-3" aria-hidden="true">Use ← → to move, Esc to close</p>
      </section>
    </div>, document.body,
  );
}
