import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react';

const TOUR_KEY = 'appblips-tour-v1';

export function TourInvitation({ onStart }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(TOUR_KEY) === 'dismissed'; }
    catch { return false; }
  });
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(TOUR_KEY, 'dismissed'); } catch { /* Optional preference. */ }
  };
  if (dismissed) return null;
  return (
    <aside className="shrink-0 flex items-center justify-center gap-3 border-b border-slate-200 bg-indigo-50 px-3 py-2 text-xs text-slate-700" aria-label="Welcome to AppBlips">
      <Compass size={16} className="shrink-0 text-indigo-600" aria-hidden="true" />
      <span className="hidden sm:inline">New here? Get to know your workspace.</span>
      <button type="button" onClick={() => { dismiss(); onStart(); }} className="tour-invite-button font-semibold text-indigo-700">Take a quick tour</button>
      <button type="button" onClick={dismiss} className="tour-invite-button rounded-lg p-2 hover:bg-indigo-100" aria-label="Dismiss tour invitation"><X size={14} /></button>
    </aside>
  );
}

export default function GuidedTour({ onClose, onViewChange, firebaseEnabled, hasCode, showCodeView }) {
  const [index, setIndex] = useState(0);
  const [wideScreen, setWideScreen] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWideScreen(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const cardRef = useRef(null);
  const [geometry, setGeometry] = useState(null);
  const steps = [
    { target: 'prompt', view: 'chat', title: 'Start with an idea', body: 'Describe the app you want in the prompt box. Include who it is for and what it should do. Starter ideas, when shown, fill the box so you can edit before sending.' },
    { target: 'prompt', view: 'chat', title: 'Build, refine, or ask', body: 'Build mode creates or changes your app. Ask mode answers questions without changing it. Send with Enter; use Shift + Enter for a new line. A new app needs a name before its first build.' },
    { target: 'preview', view: 'preview', title: 'See your app in action', body: `After a build, the Preview tab runs your app so you can try it. On phones, use Chat and Preview to switch panels. Preview tools let you check different device sizes and orientations.${showCodeView ? ' The Code tab shows the generated HTML.' : ' You can enable the Code tab in Settings.'}` },
    { target: hasCode ? 'share' : 'preview', view: 'preview', title: firebaseEnabled ? 'Share a live app' : 'Take your app with you', body: firebaseEnabled ? 'Once an app is built, Deploy appears in the preview toolbar. Sign in to publish it to a public URL or manage an existing deployment.' : 'Once an app is built, Export appears in the preview toolbar and downloads an HTML file. Open launches the current app in a new browser tab.' },
    { target: wideScreen ? 'history' : 'preview', view: 'preview', title: 'Return to an earlier version', body: wideScreen ? 'History opens your saved versions, grouped by chat session. Select a checkpoint to return to it. Once you have more than one version, the preview toolbar also shows Undo and Redo.' : 'Builds are saved as versions. Open the menu and choose History to browse checkpoints grouped by chat session. Preview tools also offers Previous and Next version controls.' },
    { target: wideScreen ? 'apps' : 'menu', title: 'Keep your apps organized', body: 'Your work saves after builds. Apps lists your saved projects so you can reopen, rename, or delete them. Use New App when you are ready to start another idea.' },
    { target: wideScreen ? 'settings' : 'menu', title: 'Make the workspace yours', body: 'Settings lets you choose a theme and chat font, show the Code tab, and control clarifying questions. You can also skip the intro animation.' },
    { target: wideScreen ? 'help' : 'menu', title: 'You are ready to explore', body: 'Help opens the full docs on building, previewing, and sharing. Try describing one small, useful app to begin.' },
  ];
  const step = steps[index];

  useLayoutEffect(() => {
    if (step.view) onViewChange(step.view);
  }, [step.view, onViewChange]);

  // Keep the spotlight attached across pane switches, resizing, and scrolling.
  useLayoutEffect(() => {
    let frame;
    const measure = () => {
      const element = [...document.querySelectorAll(`[data-tour="${step.target}"]`)].find(el => el.getBoundingClientRect().width > 0);
      const rect = element?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const offsetX = viewport?.offsetLeft || 0;
      const offsetY = viewport?.offsetTop || 0;
      const card = cardRef.current;
      const cardWidth = Math.min(360, width - 24);
      const cardHeight = card?.getBoundingClientRect().height || 300;
      const visible = rect && rect.width > 0 && rect.height > 0 && rect.bottom > offsetY && rect.top < offsetY + height;
      const target = visible ? {
        left: Math.max(offsetX + 6, rect.left - 5), top: Math.max(offsetY + 6, rect.top - 5),
        right: Math.min(offsetX + width - 6, rect.right + 5), bottom: Math.min(offsetY + height - 6, rect.bottom + 5),
      } : null;
      let top = offsetY + (height - cardHeight) / 2;
      let left = offsetX + (width - cardWidth) / 2;
      if (target) {
        if (target.bottom + 12 + cardHeight <= offsetY + height - 12) top = target.bottom + 12;
        else if (target.top - 12 - cardHeight >= offsetY + 12) top = target.top - 12 - cardHeight;
        else if (target.right + 12 + cardWidth <= offsetX + width - 12) left = target.right + 12;
        else if (target.left - 12 - cardWidth >= offsetX + 12) left = target.left - 12 - cardWidth;
        else top = offsetY + height - cardHeight - 12;
        if (left === offsetX + (width - cardWidth) / 2) left = Math.max(offsetX + 12, Math.min(target.left, offsetX + width - cardWidth - 12));
      }
      const next = { target, left, top: Math.max(offsetY + 12, top), width: cardWidth, maxHeight: height - 24 };
      setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    if (cardRef.current) observer.observe(cardRef.current);
    const target = document.querySelector(`[data-tour="${step.target}"]`);
    if (target) observer.observe(target);
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [step.target, index]);

  useEffect(() => {
    const root = document.getElementById('root');
    const previousInert = root?.inert;
    const previousFocus = document.activeElement;
    if (root) root.inert = true;
    const focusFrame = requestAnimationFrame(() => cardRef.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      if (root) root.inert = previousInert;
      const fallback = document.querySelector('[data-tour="menu"]')?.getBoundingClientRect().width ? document.querySelector('[data-tour="menu"]') : document.querySelector('[data-tour="help"]');
      const restore = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : fallback;
      restore?.focus({ preventScroll: true });
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') {
      const buttons = [...cardRef.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === cardRef.current)) {
        event.preventDefault(); first.focus();
      }
    }
  };
  const last = index === steps.length - 1;
  const target = geometry?.target;
  return createPortal(
    <div className="tour-layer" onKeyDown={handleKeyDown}>
      {target ? <div aria-hidden="true" className="tour-spotlight" style={{ left: target.left, top: target.top, width: target.right - target.left, height: target.bottom - target.top }} /> : <div className="tour-dimmer" />}
      <section ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description" className="tour-card bg-surface border border-slate-200 rounded-2xl shadow-2xl text-slate-900" style={geometry ? { left: geometry.left, top: geometry.top, width: geometry.width, maxHeight: geometry.maxHeight } : { visibility: 'hidden' }}>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-semibold text-indigo-600"><Compass size={16} aria-hidden="true" /> Workspace tour</span>
          <button type="button" onClick={onClose} aria-label="Close tour" className="tour-close text-slate-500 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>
        <div aria-live="polite" aria-atomic="true">
          <p className="text-xs text-slate-500 mt-3">Step {index + 1} of {steps.length}</p>
          <h2 id="tour-title" className="text-lg font-bold mt-2 leading-snug">{step.title}</h2>
          <p id="tour-description" className="text-sm text-slate-600 leading-relaxed mt-3">{step.body}</p>
        </div>
        <div className="flex gap-1 mt-5" aria-label="Tour steps">
          {steps.map((item, i) => <button type="button" key={item.title} aria-label={`Go to step ${i + 1}: ${item.title}`} aria-current={i === index ? 'step' : undefined} className="tour-step flex-1" onClick={() => setIndex(i)}><span className={`block h-1 rounded-full ${i <= index ? 'bg-brand' : 'bg-slate-200'}`} /></button>)}
        </div>
        <div className="flex items-center justify-between gap-2 mt-3">
          <button type="button" className="tour-button text-slate-500 hover:bg-slate-100" onClick={onClose}>Skip tour</button>
          <div className="flex gap-2">
            <button type="button" className="tour-button text-slate-700 hover:bg-slate-100 disabled:opacity-40" disabled={index === 0} onClick={() => setIndex(index - 1)}><ArrowLeft size={14} /> Back</button>
            <button type="button" className="tour-button brand-fill-text bg-brand text-white hover:bg-brand-hover" onClick={() => last ? onClose() : setIndex(index + 1)}>{last ? 'Finish' : 'Next'}{last ? <Check size={14} /> : <ArrowRight size={14} />}</button>
          </div>
        </div>
      </section>
    </div>, document.body,
  );
}
