import { useLayoutEffect, useMemo, useRef } from 'react';
import { Sparkles } from 'lucide-react';

// Seed prompts for the empty state. A short, curated gallery — static and
// deterministic, with no marquee and no hidden horizontal scroller. Presets
// flagged `featured` are surfaced (falling back to the full list, which is
// what Ask mode's six presets use); picking one drops its prompt into the
// composer via onPick.
//
// Tile palettes are a fixed set of six hues spaced around the colour wheel.
// Tailwind's own ramp cannot be used for this: it bunches sky/blue/indigo/
// violet and emerald/teal within ~20°, so six different hue names can still
// render as near-identical tiles. Each card takes the nearest hue that is
// still unused, so no two visible tiles share or approach a colour. The actual
// tile styling (light + dark) lives in starter-ideas.css under [data-hue].
const TILE_HUES = [
  { key: 'rose', hue: 350 },
  { key: 'amber', hue: 38 },
  { key: 'emerald', hue: 160 },
  { key: 'sky', hue: 199 },
  { key: 'indigo', hue: 239 },
  { key: 'fuchsia', hue: 292 },
];

// Degrees for the preset color names, used only to pick the closest tile hue.
const PRESET_HUES = {
  rose: 350,
  amber: 38,
  emerald: 160,
  sky: 199,
  indigo: 239,
  violet: 262,
  blue: 221,
  teal: 173,
};

const MAX_VISIBLE = 6;

const circularDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const presetHue = (colorString = '') => {
  const match = colorString.match(/amber|sky|emerald|violet|rose|blue|teal|indigo/);
  return match ? PRESET_HUES[match[0]] : PRESET_HUES.indigo;
};

const assignHues = (starters) => {
  const remaining = [...TILE_HUES];
  return starters.map((starter, index) => {
    const target = presetHue(starter.color);
    let best = 0;
    remaining.forEach((candidate, i) => {
      if (circularDistance(target, candidate.hue) < circularDistance(target, remaining[best].hue)) {
        best = i;
      }
    });
    const [chosen] = remaining.splice(best, 1);
    return { starter, hue: (chosen || TILE_HUES[index % TILE_HUES.length]).key };
  });
};

// Fisher-Yates over a copy, taking the first n.
const randomSample = (list, n) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
};

// Hides every chip that wrapped onto a second row, so the pills always stay on
// one line whatever the container width. Reads all offsets first, then writes,
// so hiding one chip can't shift what gets measured for the next.
const fitChipsToOneRow = (row) => {
  const chips = Array.from(row.children);
  chips.forEach((chip) => { chip.style.display = ''; });
  if (chips.length === 0) return;
  const firstTop = chips[0].offsetTop;
  const wrapped = chips.map((chip) => chip.offsetTop > firstTop);
  chips.forEach((chip, i) => { chip.style.display = wrapped[i] ? 'none' : ''; });
};

// `sampleSize` switches from the curated/featured list to a fresh random pick
// of that many ideas from the whole pool each time the gallery mounts.
// `variant="chips"` renders the same ideas as a centered row of pills (the
// first-build hero) instead of the two-column card grid.
export default function StarterIdeas({ ideas, onPick, sampleSize, variant = 'cards' }) {
  const visible = useMemo(() => {
    if (sampleSize) return randomSample(ideas, sampleSize);
    const featured = ideas.filter((idea) => idea.featured);
    return (featured.length > 0 ? featured : ideas).slice(0, MAX_VISIBLE);
  }, [ideas, sampleSize]);
  const cards = assignHues(visible);
  const chipRowRef = useRef(null);

  useLayoutEffect(() => {
    const row = chipRowRef.current;
    if (variant !== 'chips' || !row) return undefined;
    fitChipsToOneRow(row);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => fitChipsToOneRow(row));
    observer.observe(row);
    return () => observer.disconnect();
  }, [variant, visible]);

  if (variant === 'chips') {
    return (
      <div ref={chipRowRef} className="flex flex-wrap items-center justify-center gap-2 animate-fade-in" style={{ animationDelay: '0.08s' }}>
        {cards.map(({ starter, hue }) => {
          const IconComponent = starter.icon || Sparkles;
          return (
            <button
              key={starter.title}
              type="button"
              onClick={() => onPick(starter)}
              title={starter.prompt}
              className="starter-chip group inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 cursor-pointer"
            >
              <span
                data-hue={hue}
                className="starter-card-tile shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
              >
                <IconComponent size={13} strokeWidth={2.2} aria-hidden="true" />
              </span>
              <span className="text-[13px] font-semibold leading-none">{starter.title}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in" style={{ animationDelay: '0.08s' }}>
      <p className="text-xs font-semibold text-slate-500 dark:text-white/55 pt-0.5">
        Or start with one of these
      </p>

      <div className="grid grid-cols-2 gap-2">
        {cards.map(({ starter, hue }) => {
          const IconComponent = starter.icon || Sparkles;
          return (
            <button
              key={starter.title}
              type="button"
              onClick={() => onPick(starter)}
              title={starter.prompt}
              className="starter-card group flex items-start gap-2.5 text-left p-2.5 rounded-2xl cursor-pointer"
            >
              <span
                data-hue={hue}
                className="starter-card-tile shrink-0 w-9 h-9 rounded-[0.65rem] flex items-center justify-center transition-transform duration-200 group-hover:scale-[1.06]"
              >
                <IconComponent size={18} strokeWidth={2.1} aria-hidden="true" />
              </span>

              <span className="min-w-0 flex flex-col pt-0.5">
                <span className="text-sm font-bold leading-snug tracking-tight text-slate-900 dark:text-white">
                  {starter.title}
                </span>
                <span className="text-[11px] font-medium leading-snug text-slate-500 dark:text-white/50">
                  {starter.category}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
