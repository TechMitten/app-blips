import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Type, ImagePlus, Loader2, AlertTriangle, Scissors, Copy, ClipboardPaste, CopyPlus, Trash2, Move, Sparkles,
} from 'lucide-react';

const EDGE = 8;

const SUBJECT_LABELS = { heading: 'Heading', text: 'Text', image: 'Image' };

// Click-to-edit's right-click menu. On text or an image (`menu.element`):
// cut, copy, duplicate or delete it, or Move (turns drag mode on so it can
// be dragged; already on, it just closes the menu). Anywhere: Ask AI (a
// request for this spot, which App quotes from the source), or paste what was copied, or add
// a text container or an uploaded image, at the spot the frame marked with
// its insertion line. Opens at the pointer (screen coordinates from
// usePreviewBridge), portaled to <body> so the device zoom and the preview
// pane's clipping don't reach it. Using the page again closes it from the
// frame's side (insert-menu-dismissed).
export default function InsertMenu({
  menu, canPaste = false, clipboardLabel = '', onElementAction, onAskAI, onAddText, onAddImage, onClose,
}) {
  const [mode, setMode] = useState('menu');
  const [text, setText] = useState('');
  const [aiText, setAiText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const rootRef = useRef(null);
  const firstRef = useRef(null);
  const textRef = useRef(null);
  const fileRef = useRef(null);
  const canAdd = Boolean(menu.spot);
  const subject = menu.element;

  // Kept on screen: flipped to the pointer's other side when it would run
  // off the right or bottom edge.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = menu.x + width > vw - EDGE ? menu.x - width : menu.x;
    let top = menu.y + height > vh - EDGE ? menu.y - height : menu.y;
    left = Math.max(EDGE, Math.min(left, vw - width - EDGE));
    top = Math.max(EDGE, Math.min(top, vh - height - EDGE));
    setPos({ left, top });
  }, [menu.x, menu.y, mode, error]);

  // Focus moves out of the frame so Escape and the arrow keys reach the menu.
  useEffect(() => {
    if (mode === 'text' || mode === 'ai') textRef.current?.focus();
    else firstRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const submitText = () => {
    if (!text.trim() || busy) return;
    const result = onAddText(text);
    if (result?.error) setError(result.error);
  };

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const result = await onAddImage(file);
      if (result?.error) setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  const runAction = (action) => {
    if (busy) return;
    setError(null);
    const result = onElementAction(action);
    if (result?.error) setError(result.error);
  };

  const item = (action, Icon, label, { disabled = false, danger = false, focus = false } = {}) => (
    <button
      ref={focus ? firstRef : undefined}
      type="button"
      role="menuitem"
      className={`insert-menu-item${danger ? ' insert-menu-danger' : ''}`}
      disabled={disabled || busy}
      onClick={() => runAction(action)}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  );

  const onMenuKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...rootRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const at = items.indexOf(document.activeElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return createPortal(
    <div
      ref={rootRef}
      className={`insert-menu${mode !== 'menu' ? ' insert-menu-text' : ''}${mode === 'ai' ? ' insert-menu-ai' : ''}`}
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
    >
      {mode === 'menu' ? (
        <div role="menu" aria-label={subject ? 'Edit or add to the page' : 'Add to the page'} onKeyDown={onMenuKeyDown}>
          {subject && (
            <>
              <div className="insert-menu-heading">{SUBJECT_LABELS[subject.role] || 'Element'}</div>
              {item('cut', Scissors, 'Cut', { focus: true })}
              {item('copy', Copy, 'Copy')}
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className="insert-menu-item"
            disabled={!canPaste || !canAdd || busy}
            title={canPaste && clipboardLabel ? `Paste the ${clipboardLabel}` : undefined}
            onClick={() => runAction('paste')}
          >
            <ClipboardPaste size={15} />
            <span>Paste</span>
          </button>
          {subject && (
            <>
              {item('duplicate', CopyPlus, 'Duplicate')}
              {item('move', Move, 'Move')}
              {item('delete', Trash2, 'Delete', { danger: true })}
            </>
          )}
          <div className="insert-menu-divider" role="separator" />
          <button
            ref={subject ? undefined : firstRef}
            type="button"
            role="menuitem"
            className="insert-menu-item"
            disabled={busy}
            onClick={() => { setError(null); setMode('ai'); }}
          >
            <Sparkles size={15} />
            <span>Ask AI</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="insert-menu-item"
            disabled={!canAdd || busy}
            onClick={() => { setError(null); setMode('text'); }}
          >
            <Type size={15} />
            <span>Add text container</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="insert-menu-item"
            disabled={!canAdd || busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
            <span>{busy ? 'Adding image…' : 'Add image'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              handleFile(file);
            }}
          />
          {!canAdd && <p className="insert-menu-note">Nothing can be added or pasted at this spot. Right-click next to some text or an image.</p>}
        </div>
      ) : mode === 'ai' ? (
        <form
          className="insert-menu-form"
          onSubmit={(e) => { e.preventDefault(); if (aiText.trim()) onAskAI(aiText, { run: true }); }}
        >
          <label className="insert-menu-label" htmlFor="insert-menu-ai">
            {subject ? `Ask AI to change this ${(SUBJECT_LABELS[subject.role] || 'element').toLowerCase()}` : 'Ask AI to change this spot'}
          </label>
          <textarea
            id="insert-menu-ai"
            ref={textRef}
            className="element-bar-input insert-menu-textarea"
            rows={3}
            maxLength={2000}
            placeholder={subject ? 'e.g. make it bigger and centred' : 'e.g. add a signup button here'}
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (aiText.trim()) onAskAI(aiText, { run: true });
              }
            }}
          />
          <p className="insert-menu-hint">The AI is told exactly where this is in your page.</p>
          <div className="insert-menu-actions">
            <button type="button" className="nav-btn nav-btn-secondary element-bar-btn ml-auto" onClick={() => onAskAI(aiText, { run: false })}>Add to chat</button>
            <button type="submit" className="nav-btn brand-fill-text preview-key bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs element-bar-btn disabled:opacity-50 disabled:cursor-not-allowed" disabled={!aiText.trim()}>
              <Sparkles size={14} />
              <span>Ask AI</span>
            </button>
          </div>
        </form>
      ) : (
        <form
          className="insert-menu-form"
          onSubmit={(e) => { e.preventDefault(); submitText(); }}
        >
          <label className="insert-menu-label" htmlFor="insert-menu-text">New text</label>
          <textarea
            id="insert-menu-text"
            ref={textRef}
            className="element-bar-input insert-menu-textarea"
            rows={3}
            maxLength={2000}
            placeholder="Type your text…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitText();
              }
            }}
          />
          <div className="insert-menu-actions">
            <span className="insert-menu-hint">Shift+Enter for a new line</span>
            <button type="button" className="nav-btn nav-btn-secondary element-bar-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="nav-btn brand-fill-text preview-key bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs element-bar-btn disabled:opacity-50 disabled:cursor-not-allowed" disabled={!text.trim()}>Add</button>
          </div>
        </form>
      )}
      {error && (
        <p className="insert-menu-error" role="alert">
          <AlertTriangle size={14} className="flex-none" />
          <span>{error}</span>
        </p>
      )}
    </div>,
    document.body,
  );
}
