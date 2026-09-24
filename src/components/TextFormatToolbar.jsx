import { useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Minus, Plus, Check, X, ChevronDown, CaseUpper, Type, Undo2, Redo2,
} from 'lucide-react';
import { SHORTCUT_HINTS } from '../lib/shortcuts';
import { FONT_OPTIONS, findFontByStack, fontPreviewStylesheetUrl } from '../lib/fonts';

// Contextual toolbar for an in-place text edit (the Website Studio's
// click-to-edit). It docks in the same place as ElementToolbar and is built
// from the same parts. The text itself is typed on the page; this bar owns
// how it looks: font, size, weight, style, alignment, color and case.
//
// Every control previews live in the frame (the bridge's inline-format) and
// is written to the source together with the text when the session ends, as
// ONE version. Focus lives in the preview frame while typing, so the bar
// keeps mouse presses from stealing it and tells the frame to hold the
// session open while a native control (the color picker, the size field)
// has focus instead.

// Presets, not codes: nobody picking a text color wants to read a hex value.
// Neutrals first (the colors text mostly is), then hues in three tones --
// light for dark backgrounds, base, deep for light ones -- as columns, so
// each hue reads top to bottom.
const NEUTRALS = [
  { name: 'Black', hex: '#000000' },
  { name: 'Ink', hex: '#111827' },
  { name: 'Charcoal', hex: '#374151' },
  { name: 'Gray', hex: '#6b7280' },
  { name: 'Silver', hex: '#9ca3af' },
  { name: 'Mist', hex: '#e5e7eb' },
  { name: 'White', hex: '#ffffff' },
];

const HUES = [
  { name: 'Red', tones: ['#fca5a5', '#ef4444', '#b91c1c'] },
  { name: 'Orange', tones: ['#fdba74', '#f97316', '#c2410c'] },
  { name: 'Amber', tones: ['#fcd34d', '#f59e0b', '#b45309'] },
  { name: 'Green', tones: ['#86efac', '#22c55e', '#15803d'] },
  { name: 'Teal', tones: ['#5eead4', '#14b8a6', '#0f766e'] },
  { name: 'Blue', tones: ['#93c5fd', '#3b82f6', '#1d4ed8'] },
  { name: 'Violet', tones: ['#c4b5fd', '#8b5cf6', '#6d28d9'] },
  { name: 'Pink', tones: ['#f9a8d4', '#ec4899', '#be185d'] },
];
const TONE_NAMES = ['Light', '', 'Deep'];

const PRESET_NAMES = new Map([
  ...NEUTRALS.map((c) => [c.hex, c.name]),
  ...HUES.flatMap((h) => h.tones.map((hex, i) => [hex, `${TONE_NAMES[i] ? `${TONE_NAMES[i]} ` : ''}${h.name}`])),
]);

const FONT_CATEGORIES = ['System', 'Sans', 'Serif', 'Display', 'Handwriting', 'Mono'];

const PREVIEW_LINK_ID = 'appblips-font-preview';

const rgbToHex = (rgb) => {
  const m = typeof rgb === 'string' && rgb.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#111827';
  const hex = (n) => parseInt(n, 10).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
};

const GENERIC_FAMILIES = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system)$/i;
const firstFamily = (stack) => {
  const name = String(stack || '').split(',')[0].replace(/["']/g, '').trim();
  return !name || GENERIC_FAMILIES.test(name) ? 'Default font' : name;
};

const stepFor = (size) => (size < 24 ? 1 : size < 48 ? 2 : 4);

// The picker's own previews need the families themselves. One tiny, lazily
// added stylesheet (glyph-subset to the names), only once the list is opened.
const ensurePreviewFonts = () => {
  try {
    if (document.getElementById(PREVIEW_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = PREVIEW_LINK_ID;
    link.rel = 'stylesheet';
    link.href = fontPreviewStylesheetUrl();
    document.head.appendChild(link);
  } catch { /* previews fall back to the UI font */ }
};

export default function TextFormatToolbar({ typography, canUndo = false, canRedo = false, onFormat, onHold, onFinish, onUndo, onRedo }) {
  const t = typography || {};
  const [open, setOpen] = useState(null); // 'font' | 'color' | null
  const [sizeDraft, setSizeDraft] = useState(null);
  const rootRef = useRef(null);

  const currentFont = findFontByStack(t.fontFamily);
  const fontLabel = currentFont?.label || firstFamily(t.fontFamily);
  const size = Math.round(t.fontSize || 16);
  const isBold = (t.fontWeight || 400) >= 600;
  const isItalic = t.fontStyle === 'italic';
  const isUnderline = Boolean(t.underline);
  const isUpper = t.textTransform === 'uppercase';
  const colorHex = rgbToHex(t.color);
  const colorName = PRESET_NAMES.get(colorHex.toLowerCase()) || 'Custom';
  const isPreset = PRESET_NAMES.has(colorHex.toLowerCase());
  // text-align does nothing on a purely inline host, so say so instead of
  // offering keys that appear broken.
  const alignEnabled = !String(t.display || '').startsWith('inline') || /inline-(block|flex|grid)/.test(t.display);

  useEffect(() => {
    if (open === 'font') ensurePreviewFonts();
    if (!open) return undefined;
    const dismiss = (e) => {
      if (e.type === 'keydown') {
        if (e.key === 'Escape') { setOpen(null); e.stopPropagation(); }
      } else if (rootRef.current && !rootRef.current.querySelector('.element-bar-pop')?.parentElement?.contains(e.target)) {
        setOpen(null);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss, true);
    };
  }, [open]);

  const format = (styles) => onFormat?.(styles);

  const commitSize = (raw) => {
    const n = Math.round(parseFloat(raw));
    setSizeDraft(null);
    if (Number.isFinite(n)) format({ fontSize: `${Math.min(200, Math.max(8, n))}px` });
  };

  const bumpSize = (dir) => {
    const next = size + dir * stepFor(dir > 0 ? size : size - 1);
    format({ fontSize: `${Math.min(200, Math.max(8, next))}px` });
  };

  const toggleKey = (label, pressed, onClick, Icon, tip) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      data-tip={tip || label}
      className={`nav-segmented-btn nav-segmented-btn-icon ${pressed ? 'nav-segmented-btn-active' : ''}`}
    >
      <Icon size={16} />
    </button>
  );

  const alignKey = (value, Icon, label) => (
    <button
      key={value}
      type="button"
      onClick={() => format({ textAlign: value })}
      disabled={!alignEnabled}
      aria-pressed={alignEnabled && t.textAlign === value}
      aria-label={label}
      data-tip={alignEnabled ? label : 'Alignment applies to block text'}
      className={`nav-segmented-btn nav-segmented-btn-icon ${alignEnabled && t.textAlign === value ? 'nav-segmented-btn-active' : ''}`}
    >
      <Icon size={16} />
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="element-bar element-bar-text"
      role="toolbar"
      aria-label="Format text"
      // Keep focus (and so the caret) in the page while pressing keys here;
      // real inputs still need theirs, which the hold message covers.
      onMouseDown={(e) => { if (!e.target.closest('input')) e.preventDefault(); }}
      onPointerDownCapture={() => onHold?.(true)}
      onKeyDown={(e) => { if (e.key === 'Escape' && !open) onFinish?.(false); }}
    >
      <div className="element-bar-id">
        <span className="element-bar-chip"><Type size={12} aria-hidden="true" />Text</span>
      </div>

      <span className="chrome-divider element-bar-divider" aria-hidden="true" />

      <div className="element-bar-body element-bar-format">
        {/* Session history: typing and formatting steps, not page versions */}
        <div className="nav-segmented-group" role="group" aria-label="Undo and redo">
          <button
            type="button"
            className="nav-segmented-btn nav-segmented-btn-icon"
            onClick={() => onUndo?.()}
            disabled={!canUndo}
            aria-label="Undo"
            data-tip="Undo"
            data-tip-key={SHORTCUT_HINTS.undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="nav-segmented-btn nav-segmented-btn-icon"
            onClick={() => onRedo?.()}
            disabled={!canRedo}
            aria-label="Redo"
            data-tip="Redo"
            data-tip-key={SHORTCUT_HINTS.redo}
          >
            <Redo2 size={16} />
          </button>
        </div>

        {/* Font */}
        <div className="element-bar-anchor">
          <button
            type="button"
            className="element-bar-select"
            aria-haspopup="listbox"
            aria-expanded={open === 'font'}
            aria-label={`Font: ${fontLabel}`}
            data-tip={open === 'font' ? undefined : 'Font'}
            onClick={() => setOpen(open === 'font' ? null : 'font')}
            style={currentFont ? { fontFamily: currentFont.stack } : undefined}
          >
            <span className="element-bar-select-label">{fontLabel}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {open === 'font' && (
            <div className="element-bar-pop element-bar-pop-fonts" role="listbox" aria-label="Fonts">
              {FONT_CATEGORIES.map((category) => (
                <div key={category}>
                  <div className="element-bar-pop-heading">{category}</div>
                  {FONT_OPTIONS.filter((f) => f.category === category).map((font) => (
                    <button
                      key={font.id}
                      type="button"
                      role="option"
                      aria-selected={currentFont?.id === font.id}
                      className={`element-bar-font ${currentFont?.id === font.id ? 'element-bar-font-active' : ''}`}
                      style={{ fontFamily: font.stack }}
                      onClick={() => { format({ fontFamily: font.stack }); setOpen(null); }}
                    >
                      <span>{font.label}</span>
                      {currentFont?.id === font.id && <Check size={14} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Size */}
        <div className="nav-segmented-group" role="group" aria-label="Font size">
          <button type="button" className="nav-segmented-btn nav-segmented-btn-icon" onClick={() => bumpSize(-1)} disabled={size <= 8} aria-label="Smaller" data-tip="Smaller">
            <Minus size={15} />
          </button>
          <input
            type="text"
            inputMode="numeric"
            className="element-bar-size"
            aria-label="Font size in pixels"
            value={sizeDraft ?? String(size)}
            onChange={(e) => setSizeDraft(e.target.value.replace(/[^\d.]/g, '').slice(0, 3))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitSize(e.currentTarget.value); }
              else if (e.key === 'Escape') { e.stopPropagation(); setSizeDraft(null); }
            }}
            onBlur={(e) => { if (sizeDraft !== null) commitSize(e.currentTarget.value); }}
          />
          <button type="button" className="nav-segmented-btn nav-segmented-btn-icon" onClick={() => bumpSize(1)} disabled={size >= 200} aria-label="Larger" data-tip="Larger">
            <Plus size={15} />
          </button>
        </div>

        {/* Style */}
        <div className="nav-segmented-group" role="group" aria-label="Text style">
          {toggleKey('Bold', isBold, () => format({ fontWeight: isBold ? '400' : '700' }), Bold)}
          {toggleKey('Italic', isItalic, () => format({ fontStyle: isItalic ? 'normal' : 'italic' }), Italic)}
          {toggleKey('Underline', isUnderline, () => format({ textDecorationLine: isUnderline ? 'none' : 'underline' }), Underline)}
          {toggleKey('Uppercase', isUpper, () => format({ textTransform: isUpper ? 'none' : 'uppercase' }), CaseUpper)}
        </div>

        {/* Alignment */}
        <div className="nav-segmented-group" role="group" aria-label="Alignment">
          {alignKey('left', AlignLeft, 'Align left')}
          {alignKey('center', AlignCenter, 'Align center')}
          {alignKey('right', AlignRight, 'Align right')}
        </div>

        {/* Color */}
        <div className="element-bar-anchor">
          <button
            type="button"
            className="element-bar-select element-bar-select-color"
            aria-haspopup="dialog"
            aria-expanded={open === 'color'}
            aria-label={`Text color: ${colorName}`}
            data-tip={open === 'color' ? undefined : 'Text color'}
            onClick={() => setOpen(open === 'color' ? null : 'color')}
          >
            <span className="element-bar-color-dot" style={{ background: t.color || colorHex }} />
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {open === 'color' && (
            <div className="element-bar-pop element-bar-pop-colors" role="dialog" aria-label="Text color">
              <div className="element-bar-swatches">
                {NEUTRALS.map(({ name, hex }) => (
                  <button
                    key={hex}
                    type="button"
                    className={`element-bar-chipcolor ${colorHex.toLowerCase() === hex ? 'element-bar-chipcolor-active' : ''}`}
                    style={{ background: hex }}
                    aria-label={name}
                    aria-pressed={colorHex.toLowerCase() === hex}
                    title={name}
                    onClick={() => format({ color: hex })}
                  >
                    {colorHex.toLowerCase() === hex && <Check size={14} className="element-bar-chipcheck" style={{ color: hex === '#ffffff' || hex === '#e5e7eb' ? '#111827' : '#ffffff' }} aria-hidden="true" />}
                  </button>
                ))}
                {/* Anything not in the presets: the browser's own picker, behind a swatch. */}
                <label
                  className={`element-bar-chipcolor element-bar-chipcustom ${!isPreset ? 'element-bar-chipcolor-active' : ''}`}
                  title="Custom color"
                >
                  {!isPreset && <span className="element-bar-chipcustom-dot" style={{ background: colorHex }} />}
                  <input
                    type="color"
                    value={colorHex}
                    onChange={(e) => format({ color: e.target.value })}
                    aria-label="Pick a custom text color"
                  />
                </label>
              </div>
              <div className="element-bar-swatches element-bar-swatches-hues">
                {[0, 1, 2].flatMap((tone) => HUES.map((hue) => {
                  const hex = hue.tones[tone];
                  const label = `${TONE_NAMES[tone] ? `${TONE_NAMES[tone]} ` : ''}${hue.name}`;
                  const active = colorHex.toLowerCase() === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      className={`element-bar-chipcolor ${active ? 'element-bar-chipcolor-active' : ''}`}
                      style={{ background: hex }}
                      aria-label={label}
                      aria-pressed={active}
                      title={label}
                      onClick={() => format({ color: hex })}
                    >
                      {active && <Check size={14} className="element-bar-chipcheck" style={{ color: tone === 0 ? '#111827' : '#ffffff' }} aria-hidden="true" />}
                    </button>
                  );
                }))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="element-bar-actions">
        <span className="element-bar-keys" aria-hidden="true">
          <kbd>Enter</kbd> save<span className="element-bar-keys-sep" /><kbd>Esc</kbd> options
        </span>
        <button
          type="button"
          onClick={() => onFinish?.(false)}
          className="nav-btn nav-ghost element-bar-btn"
          data-tip="Discard your typing and formatting"
        >
          <X size={15} />
          <span>Cancel</span>
        </button>
        <button
          type="button"
          onClick={() => onFinish?.(true)}
          className="nav-btn brand-fill-text preview-key bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs"
          data-tip="Save the text and formatting as a new version"
          data-tip-align="end"
        >
          <Check size={15} />
          <span>Done</span>
        </button>
      </div>
    </div>
  );
}
