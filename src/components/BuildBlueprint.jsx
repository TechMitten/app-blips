import { useEffect, useState } from 'react';
import { Check, Code2, EyeOff } from 'lucide-react';
import ThinkingElapsed from './ThinkingElapsed';
import useElapsedSeconds from '../hooks/useElapsedSeconds';

// Wireframe blocks per studio, as [left, top, width, height] in percent of the
// frame. They light up in order as the build progresses, so the picture reads
// as the page assembling itself without ever rendering half-written HTML.
const LAYOUTS = {
  website: [
    [4, 4, 92, 7], [4, 14, 92, 30], [4, 48, 28, 20], [36, 48, 28, 20],
    [68, 48, 28, 20], [4, 72, 60, 5], [4, 80, 44, 5], [4, 90, 92, 6],
  ],
  app: [
    [4, 4, 92, 7], [4, 14, 22, 82], [30, 14, 32, 18], [66, 14, 30, 18],
    [30, 36, 66, 30], [30, 70, 31, 26], [65, 70, 31, 26],
  ],
  game: [
    [4, 4, 28, 7], [68, 4, 28, 7], [4, 14, 92, 56], [28, 74, 44, 8],
    [4, 86, 20, 10], [76, 86, 20, 10],
  ],
};
// Phones are tall, so the same story is told in a single column.
const LAYOUT_TOUCH = [
  [6, 3, 88, 5], [6, 11, 88, 30], [6, 45, 88, 12], [6, 60, 88, 12],
  [6, 75, 42, 9], [52, 75, 42, 9], [6, 90, 88, 6],
];

const STEPS = ['Understanding your idea', 'Writing the code', 'Checking for errors', 'Finishing up'];

// The stream gives no percentage, so progress is estimated from how much code
// has arrived and eases toward (never reaches) the end until the build moves
// on. It only needs to feel honest, not be exact.
const CHARS_FOR_TWO_THIRDS = 9000;

// Where in the build we are, from the signals the overlay already has. The
// stage never moves backwards (a repair pass inside "Writing" must not
// un-tick earlier steps).
function rawStage({ isThinking, status }) {
  const s = (status || '').toLowerCase();
  if (s.startsWith('writing a summary')) return 3;
  if (s.includes('syntax') || s.includes('fixing') || s.includes('verifying') || s.includes('checking')) return 2;
  if (isThinking || s.startsWith('analyzing')) return 0;
  return 1;
}

// Replaces the plain spinner while a build runs: a wireframe that fills in, a
// four-step timeline and a quiet footer. The raw code stays one click away
// (`codeSlot`), since some people like watching it. Presentational only: it
// reads the stream text through a ref and never touches generatedCode.
export default function BuildBlueprint({
  studioMode = 'app',
  isTouch = false,
  isThinking = false,
  thinkingSince = null,
  status = null,
  page = null,
  codeRef = null,
  codeSlot = null,
}) {
  const [startedAt] = useState(() => Date.now());
  const seconds = useElapsedSeconds(startedAt);
  const [chars, setChars] = useState(0);
  const [lines, setLines] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const [stage, setStage] = useState(0);

  // Five reads a second is plenty for a counter and a progress estimate.
  useEffect(() => {
    if (!codeRef) return undefined;
    const id = setInterval(() => {
      const text = codeRef.current || '';
      setChars((prev) => (prev === text.length ? prev : text.length));
      let n = 0;
      for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n += 1;
      setLines((prev) => (prev === n ? prev : n));
    }, 200);
    return () => clearInterval(id);
  }, [codeRef]);

  const next = rawStage({ isThinking, status });
  if (next > stage) setStage(next);

  const progress = stage >= 2
    ? 1
    : 1 - Math.exp(-(codeRef ? chars / CHARS_FOR_TWO_THIRDS : seconds / 40) * 1.1);
  const blocks = isTouch ? LAYOUT_TOUCH : (LAYOUTS[studioMode] || LAYOUTS.app);

  const detail = (index) => {
    if (index !== stage) return null;
    if (index === 0 && isThinking) return <>Reasoning · <ThinkingElapsed since={thinkingSince} /></>;
    if (index === 1 && page?.page) {
      return page.total > 1 ? `${page.page} · page ${page.step} of ${page.total}` : page.page;
    }
    if (status && status !== 'Synthesizing your app from your prompt.') return status;
    return null;
  };

  return (
    <div className="build-blueprint" role="status" aria-live="polite">
      {showCode && codeSlot ? (
        <div className="build-blueprint-code">{codeSlot}</div>
      ) : (
        <div className={`build-blueprint-frame ${isTouch ? 'is-touch' : ''}`} aria-hidden="true">
          {blocks.map(([x, y, w, h], i) => {
            const on = progress >= (i + 0.5) / blocks.length;
            return (
              <span
                key={i}
                className={`build-blueprint-block ${on ? 'is-on' : ''}`}
                style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, '--bp-i': i }}
              />
            );
          })}
        </div>
      )}

      <ol className="build-blueprint-steps">
        {STEPS.map((label, i) => {
          const state = i < stage ? 'done' : i === stage ? 'active' : 'todo';
          const extra = detail(i);
          return (
            <li key={label} className={`build-blueprint-step is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
              <span className="build-blueprint-dot" aria-hidden="true">
                {state === 'done' ? <Check size={11} strokeWidth={3.5} /> : null}
              </span>
              <span className="build-blueprint-step-text">
                <span className="build-blueprint-step-label">{label}</span>
                {extra && <span key={String(extra)} className="build-blueprint-step-detail">{extra}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="build-blueprint-footer">
        <span className="tabular-nums">{seconds}s</span>
        {codeRef && lines > 0 && <span className="tabular-nums">{lines.toLocaleString()} lines</span>}
        {codeRef && codeSlot && (
          <button type="button" className="build-blueprint-toggle" onClick={() => setShowCode((v) => !v)} aria-pressed={showCode}>
            {showCode ? <EyeOff size={12} aria-hidden="true" /> : <Code2 size={12} aria-hidden="true" />}
            {showCode ? 'Hide code' : 'Show code'}
          </button>
        )}
      </div>
    </div>
  );
}
