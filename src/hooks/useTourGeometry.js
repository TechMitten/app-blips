import { useLayoutEffect, useState } from 'react';

// Positioning engine for the guided tour: finds the step's anchor, keeps a
// spotlight rect on it, and places the card beside it with an arrow pointing
// at the anchor's centre. Stays attached across pane switches, resizing,
// scrolling, the on-screen keyboard (visualViewport), and late-mounting
// anchors (e.g. Deploy appearing once a build lands).

const GAP = 14;      // card <-> spotlight
const MARGIN = 12;   // card <-> viewport edge
const PAD = 6;       // spotlight <-> anchor
const ARROW_INSET = 22;
export const SHEET_QUERY = '(max-width: 639px)';

// Anchors like `apps`/`settings`/`help` exist twice (desktop nav + the hidden
// mobile drawer); the visible one is the one that counts. `names` is a
// fallback list: the first name with a visible element wins.
export function findTarget(names) {
  for (const name of [].concat(names)) {
    const element = [...document.querySelectorAll(`[data-tour="${name}"]`)]
      .find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (element) return element;
  }
  return null;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

function sameGeometry(a, b) {
  if (!a || !b) return a === b;
  const keys = ['left', 'top', 'width', 'maxHeight', 'placement', 'arrow', 'sheet'];
  if (keys.some(k => a[k] !== b[k])) return false;
  const ta = a.target; const tb = b.target;
  if (!ta || !tb) return ta === tb;
  return ta.left === tb.left && ta.top === tb.top && ta.width === tb.width && ta.height === tb.height;
}

function viewportBox() {
  const vv = window.visualViewport;
  return {
    x: vv?.offsetLeft || 0,
    y: vv?.offsetTop || 0,
    width: vv?.width || window.innerWidth,
    height: vv?.height || window.innerHeight,
  };
}

function computeGeometry(element, card, preferred) {
  const vp = viewportBox();
  const sheet = window.matchMedia(SHEET_QUERY).matches;
  const cardWidth = sheet ? vp.width : Math.min(380, vp.width - MARGIN * 2);
  const cardHeight = card?.getBoundingClientRect().height || 260;
  const rect = element?.getBoundingClientRect();
  const visible = rect && rect.width > 0 && rect.height > 0
    && rect.bottom > vp.y && rect.top < vp.y + vp.height;

  let target = null;
  if (visible) {
    const left = Math.max(vp.x + PAD, rect.left - PAD);
    const top = Math.max(vp.y + PAD, rect.top - PAD);
    const right = Math.min(vp.x + vp.width - PAD, rect.right + PAD);
    const bottom = Math.min(vp.y + vp.height - PAD, rect.bottom + PAD);
    target = { left: Math.round(left), top: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
  }

  // Phones: the card docks as a bottom sheet, so only the spotlight moves.
  if (sheet) {
    return { target, sheet: true, placement: 'sheet', arrow: null, left: 0, top: 0, width: cardWidth, maxHeight: Math.round(vp.height * 0.6) };
  }

  const maxHeight = Math.round(vp.height - MARGIN * 2);
  if (!target) {
    return {
      target: null, sheet: false, placement: 'center', arrow: null, width: cardWidth, maxHeight,
      left: Math.round(vp.x + (vp.width - cardWidth) / 2),
      top: Math.round(vp.y + Math.max(MARGIN, (vp.height - cardHeight) / 2)),
    };
  }

  const t = { ...target, right: target.left + target.width, bottom: target.top + target.height };
  const fits = {
    bottom: t.bottom + GAP + cardHeight <= vp.y + vp.height - MARGIN,
    top: t.top - GAP - cardHeight >= vp.y + MARGIN,
    right: t.right + GAP + cardWidth <= vp.x + vp.width - MARGIN,
    left: t.left - GAP - cardWidth >= vp.x + MARGIN,
  };
  const order = [preferred, 'bottom', 'top', 'right', 'left'].filter(Boolean);
  const placement = order.find(side => fits[side]) || 'overlay';

  const minLeft = vp.x + MARGIN;
  const maxLeft = vp.x + vp.width - cardWidth - MARGIN;
  const minTop = vp.y + MARGIN;
  const maxTop = vp.y + vp.height - cardHeight - MARGIN;
  const centerX = t.left + t.width / 2;
  const centerY = t.top + t.height / 2;
  let left; let top; let arrow = null;

  if (placement === 'bottom' || placement === 'top') {
    left = clamp(centerX - cardWidth / 2, minLeft, maxLeft);
    top = placement === 'bottom' ? t.bottom + GAP : t.top - GAP - cardHeight;
    arrow = clamp(centerX - left, ARROW_INSET, cardWidth - ARROW_INSET);
  } else if (placement === 'left' || placement === 'right') {
    left = placement === 'right' ? t.right + GAP : t.left - GAP - cardWidth;
    top = clamp(centerY - cardHeight / 2, minTop, maxTop);
    arrow = clamp(centerY - top, ARROW_INSET, cardHeight - ARROW_INSET);
  } else {
    // Anchor fills the screen (e.g. the preview pane on a tablet): float the
    // card inside it, bottom-centred, with no arrow.
    left = clamp(centerX - cardWidth / 2, minLeft, maxLeft);
    top = clamp(t.bottom - cardHeight - MARGIN * 2, minTop, maxTop);
  }

  return {
    target, sheet: false, placement, width: cardWidth, maxHeight,
    left: Math.round(left), top: Math.round(clamp(top, minTop, Math.max(minTop, maxTop))),
    arrow: arrow == null ? null : Math.round(arrow),
  };
}

export default function useTourGeometry({ targets, placement, cardRef, stepKey }) {
  // Joined so a fresh-but-equal array never re-subscribes every listener.
  const targetKey = [].concat(targets).join('|');
  const [geometry, setGeometry] = useState(null);

  useLayoutEffect(() => {
    let frame;
    let observed = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const resizeObserver = new ResizeObserver(() => schedule());

    const measure = () => {
      const element = findTarget(targetKey.split('|'));
      // Re-point the observer when the visible anchor changes (pane switch,
      // breakpoint crossing, Deploy mounting after a build).
      if (element !== observed) {
        if (observed) resizeObserver.unobserve(observed);
        if (element) resizeObserver.observe(element);
        observed = element;
      }
      const next = computeGeometry(element, cardRef.current, placement);
      setGeometry(previous => (sameGeometry(previous, next) ? previous : next));
    };
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }

    resizeObserver.observe(document.documentElement);
    if (cardRef.current) resizeObserver.observe(cardRef.current);

    // The pane switch for this step was committed in the same tick; wait one
    // frame so the anchor has its real layout, then bring it on screen.
    const scrollFrame = requestAnimationFrame(() => {
      const element = findTarget(targetKey.split('|'));
      const rect = element?.getBoundingClientRect();
      if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
      }
      measure();
    });

    // Cheap catch-all for anchors that mount/unmount or change size via class
    // toggles without resizing the document.
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-tour', 'hidden'] });

    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [targetKey, placement, cardRef, stepKey]);

  return geometry;
}
