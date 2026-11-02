import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Code2, Check, Copy, FileQuestion, Image as ImageIcon, Loader2, PanelLeftClose, PanelLeftOpen, Pencil, Save, X } from 'lucide-react';
import { highlightSource, highlightTokens } from '../lib/sourceHighlight';
import { caretPosition, getCompletions } from '../lib/codeComplete';
import { describeFile, mediaKind } from '../lib/codebase/fileInfo';
import { formatBytes, utf8Length } from '../lib/codebase/paths';
import FileExplorer, { FileIcon } from './FileExplorer';
import { logError } from '../lib/errorLog';

const EXPLORER_WIDTH_KEY = 'orion-file-explorer-width';
const EXPLORER_OPEN_KEY = 'orion-file-explorer-open';
const MIN_EXPLORER = 180;
const MAX_EXPLORER = 480;

// Unsaved edits survive switching to the Preview tab (which unmounts this
// view) for the rest of the session, keyed by project and file. They are
// only restored while the file still matches what the edit started from.
const unsavedDrafts = new Map();

function readStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: keep the in-memory value */ }
}

// Images, fonts, video and audio can't be shown as code, so they get a real
// preview. Only <img>/<video>/<audio> and FontFace touch the bytes: none of
// them run script, even for an SVG.
function MediaPreview({ path, url }) {
  const kind = mediaKind(path);
  const [info, setInfo] = useState(null);
  const [fontFamily, setFontFamily] = useState(null);

  useEffect(() => {
    if (kind !== 'font' || !url) return undefined;
    let cancelled = false;
    const family = `appblips-preview-${Math.random().toString(36).slice(2)}`;
    const face = new FontFace(family, `url("${url}")`);
    face.load().then((loaded) => {
      if (cancelled) return;
      document.fonts.add(loaded);
      setFontFamily(family);
    }).catch((err) => {
      if (cancelled) return;
      logError('Could not load a font file for a preview', err);
      setInfo('This font could not be loaded for a preview.');
    });
    return () => { cancelled = true; document.fonts.delete(face); };
  }, [kind, url]);

  if (!url || !kind) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-400">
        <FileQuestion size={36} className="text-slate-500" />
        <span>This file can't be shown here, but it's kept in your project and included when you download it.</span>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      {kind === 'image' && (
        <img
          src={url}
          alt={path.split('/').pop()}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            setInfo(`${w} × ${h} pixels`);
            // Icons and sprites a few pixels wide are blown up (crisply) so
            // there is something to see.
            if (w && w < 96) Object.assign(e.currentTarget.style, { width: `${Math.min(8, Math.floor(96 / w)) * w}px`, imageRendering: 'pixelated' });
          }}
          className="max-h-[70%] max-w-full rounded border border-neutral-800 object-contain [background:repeating-conic-gradient(#262626_0_25%,#171717_0_50%)_0_0/16px_16px]"
        />
      )}
      {kind === 'video' && <video src={url} controls className="max-h-[70%] max-w-full rounded" />}
      {kind === 'audio' && <audio src={url} controls />}
      {kind === 'font' && fontFamily && (
        <div className="max-w-full space-y-2 text-center text-slate-100" style={{ fontFamily }}>
          <div className="text-5xl">Aa Bb Cc</div>
          <div className="text-xl">The quick brown fox jumps over the lazy dog</div>
          <div className="text-base text-slate-400">0123456789 !?&amp;@</div>
        </div>
      )}
      {info && <span className="text-xs text-slate-500">{info}</span>}
    </div>
  );
}

// Clickable path above the code: each folder reveals itself in the explorer.
function Breadcrumbs({ path, onReveal }) {
  const parts = path.split('/');
  return (
    <nav className="flex min-w-0 items-center gap-0.5 overflow-hidden text-xs" aria-label="File location">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        return (
          <span key={i} className={`flex items-center gap-0.5 ${isLast ? 'min-w-0' : 'shrink-0'}`}>
            {i > 0 && <ChevronRight size={12} className="shrink-0 text-slate-600" aria-hidden="true" />}
            {isLast ? (
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-slate-100">
                <FileIcon path={path} size={13} />
                <span className="truncate">{part}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onReveal(parts.slice(0, i + 1).join('/'))}
                className="rounded px-1 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                title="Show this folder in the file list"
              >
                {part}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// Editor-styled view of the generated (or streaming) HTML, or, for imported
// codebases, a file explorer beside the selected file. Read-only until the
// user presses Edit; saving goes through onSaveCode as a new version.
export default function CodeView({
  code, isGenerating, copied, onCopy, autoFollow = true,
  pages = [], activePage = 'index.html', writingPage = null, onSelectPage,
  files = null, activeFile = null, activeFileIsBinary = false, onSelectFile,
  fileChanges = {}, entryFile = null, projectKey = 'default', assetUrl = null,
  onSaveCode = null, autocomplete = true,
}) {
  const hasTabs = pages.length > 1;
  const hasFileList = Array.isArray(files);
  const scrollRef = useRef(null);
  const containerRef = useRef(null);
  // Tracks whether the view should keep following new lines as they stream in;
  // cleared when the user scrolls away from the bottom to read earlier code.
  const stickToBottomRef = useRef(true);
  const [explorerOpen, setExplorerOpen] = useState(() => readStored(EXPLORER_OPEN_KEY, true));
  const [explorerWidth, setExplorerWidth] = useState(() => {
    const stored = Number(readStored(EXPLORER_WIDTH_KEY, 240));
    return Number.isFinite(stored) ? Math.min(MAX_EXPLORER, Math.max(MIN_EXPLORER, stored)) : 240;
  });
  const [revealRequest, setRevealRequest] = useState(null);
  const [svgAsCode, setSvgAsCode] = useState(false);
  // Hand editing: `target` is the page or file being edited, `base` the code
  // it started from (to notice the AI or undo changing it underneath).
  const editTarget = hasFileList ? activeFile : activePage;
  const draftKey = `${projectKey}\u0000${editTarget}`;
  const [editing, setEditing] = useState(() => {
    const stashed = unsavedDrafts.get(draftKey);
    return stashed && stashed.base === code ? stashed : null;
  });
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef(null);
  const editorLayerRef = useRef(null);
  // Open autocomplete list: { start, prefix, items, index, top, left }.
  const [suggest, setSuggest] = useState(null);
  const isEditing = Boolean(editing && editing.target === editTarget);
  const isDirty = isEditing && editing.draft !== editing.base;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // Keep unsaved work if this view goes away (switching to Preview).
  useEffect(() => () => {
    const current = editingRef.current;
    if (current && current.draft !== current.base) unsavedDrafts.set(current.key, current);
  }, []);

  // Switching page/file some other way (undo, the AI) ends the edit; the
  // switches made in this view ask first (see confirmLeave).
  useEffect(() => {
    if (editing && editing.target !== editTarget) {
      setEditing(null);
      setSaveError(null);
    }
  }, [editing, editTarget]);

  const confirmLeave = () => !isDirty || window.confirm('You have unsaved code changes. Discard them?');
  const guard = (fn) => (arg) => {
    if (!confirmLeave()) return;
    if (editing) unsavedDrafts.delete(editing.key);
    setEditing(null);
    setSaveError(null);
    fn?.(arg);
  };

  const startEditing = () => {
    setSaveError(null);
    setEditing({ key: draftKey, target: editTarget, base: code || '', draft: code || '' });
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  };

  const cancelEditing = () => {
    if (!confirmLeave()) return;
    unsavedDrafts.delete(draftKey);
    setEditing(null);
    setSaveError(null);
  };

  const saveEditing = async () => {
    if (!isEditing || saving || isGenerating) return;
    if (!isDirty) { setEditing(null); return; }
    if ((code || '') !== editing.base
      && !window.confirm('This code changed since you started editing (for example an AI edit or undo). Save your version anyway?')) return;
    setSaving(true);
    try {
      const result = await onSaveCode(editing.target, editing.draft);
      if (result && result.ok === false) {
        setSaveError(result.error || 'Could not save your changes.');
        return;
      }
      unsavedDrafts.delete(draftKey);
      setEditing(null);
      setSaveError(null);
    } catch (err) {
      logError('Could not save hand-edited code', err);
      setSaveError('Could not save your changes.');
    } finally {
      setSaving(false);
    }
  };

  const completionPath = hasFileList ? activeFile : editTarget;

  // Where to show the list: just under the caret. The editor is monospaced
  // with a known line height, so line/column maths is enough (no DOM probing
  // of the text area, which browsers don't expose).
  const updateSuggestions = (el) => {
    if (!autocomplete || !el || el.selectionStart !== el.selectionEnd) { setSuggest(null); return; }
    const caret = el.selectionStart;
    const result = getCompletions(el.value, caret, completionPath);
    const layer = editorLayerRef.current;
    if (!result || !layer) { setSuggest(null); return; }
    const style = getComputedStyle(layer);
    const lineHeight = parseFloat(style.lineHeight) || 21;
    const ctx = document.createElement('canvas').getContext('2d');
    let charWidth = 7.8;
    if (ctx) { ctx.font = `${style.fontSize} ${style.fontFamily}`; charWidth = ctx.measureText('0000000000').width / 10 || charWidth; }
    const { line, column } = caretPosition(el.value, result.start, 2);
    setSuggest({
      ...result,
      index: 0,
      top: (line + 1) * lineHeight,
      left: (parseFloat(style.paddingLeft) || 0) + column * charWidth,
    });
  };

  const acceptSuggestion = (word) => {
    const el = textareaRef.current;
    if (!el || !suggest) return;
    const caret = el.selectionStart;
    setSuggest(null);
    el.focus({ preventScroll: true });
    // Replace the typed prefix with the whole word. execCommand keeps native
    // undo (Ctrl+Z) working; the fallback edits the draft directly.
    el.setSelectionRange(suggest.start, caret);
    if (!document.execCommand?.('insertText', false, word)) {
      const next = `${el.value.slice(0, suggest.start)}${word}${el.value.slice(caret)}`;
      setEditing((cur) => ({ ...cur, draft: next }));
      const end = suggest.start + word.length;
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = end; });
    }
  };

  useEffect(() => {
    if (!autocomplete || !isEditing) setSuggest(null);
  }, [autocomplete, isEditing]);

  const handleEditorKeyDown = (e) => {
    if (suggest && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setSuggest((cur) => cur && { ...cur, index: (cur.index + step + cur.items.length) % cur.items.length });
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault();
        acceptSuggestion(suggest.items[suggest.index]);
        return;
      }
      if (e.key === 'Escape') {
        // Closes the list only; a second Escape leaves edit mode as before.
        e.preventDefault();
        setSuggest(null);
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) setSuggest(null);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveEditing();
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Indent instead of leaving the editor. execCommand keeps the browser's
      // own undo history working; Shift+Tab still moves focus out.
      if (e.shiftKey) return;
      e.preventDefault();
      if (!document.execCommand?.('insertText', false, '  ')) {
        const el = e.currentTarget;
        const { selectionStart: start, selectionEnd: end, value } = el;
        const next = `${value.slice(0, start)}  ${value.slice(end)}`;
        setEditing((cur) => ({ ...cur, draft: next }));
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
      }
    } else if (e.key === 'Escape' && !isDirty) {
      e.preventDefault();
      cancelEditing();
    }
  };

  useLayoutEffect(() => {
    if (isGenerating) stickToBottomRef.current = true;
  }, [isGenerating]);

  useLayoutEffect(() => {
    if (!autoFollow || !isGenerating || !stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [code, isGenerating, autoFollow]);

  // A newly opened file starts at its top, not wherever the last one was.
  useLayoutEffect(() => {
    if (hasFileList && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [hasFileList, activeFile]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  };

  const toggleExplorer = () => {
    setExplorerOpen((open) => { writeStored(EXPLORER_OPEN_KEY, !open); return !open; });
  };

  const revealFolder = (path) => {
    if (!explorerOpen) toggleExplorer();
    setRevealRequest({ path, isFolder: true, at: Date.now() });
  };

  // Drag the divider to resize the explorer; the width is remembered.
  const startResize = (e) => {
    e.preventDefault();
    const left = containerRef.current?.getBoundingClientRect().left ?? 0;
    let width = explorerWidth;
    const onMove = (ev) => {
      width = Math.min(MAX_EXPLORER, Math.max(MIN_EXPLORER, ev.clientX - left));
      setExplorerWidth(width);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      writeStored(EXPLORER_WIDTH_KEY, width);
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleResizeKey = (e) => {
    const step = e.shiftKey ? 40 : 16;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = Math.min(MAX_EXPLORER, Math.max(MIN_EXPLORER, explorerWidth + (e.key === 'ArrowRight' ? step : -step)));
    setExplorerWidth(next);
    writeStored(EXPLORER_WIDTH_KEY, next);
  };

  const isSvgText = hasFileList && !activeFileIsBinary && /\.svg$/i.test(activeFile || '') && Boolean(code);
  const highlighted = useMemo(
    () => (isEditing ? '' : highlightSource(code, hasFileList ? activeFile : 'index.html')),
    [isEditing, code, hasFileList, activeFile],
  );
  const draft = isEditing ? editing.draft : '';
  // A text area ending in a newline shows an empty last line; a <pre> doesn't,
  // so the layer gets a space there to keep the same number of lines.
  const editorHighlighted = useMemo(
    () => (isEditing ? highlightTokens(draft, hasFileList ? activeFile : 'index.html') + (draft === '' || draft.endsWith('\n') ? ' ' : '') : ''),
    [isEditing, draft, hasFileList, activeFile],
  );
  const editorLineNumbers = useMemo(() => {
    if (!isEditing) return '';
    const count = draft.split('\n').length;
    return Array.from({ length: count }, (_, i) => i + 1).join('\n');
  }, [isEditing, draft]);
  const canEdit = Boolean(onSaveCode) && !activeFileIsBinary && !(isSvgText && !svgAsCode)
    && !(hasFileList ? !activeFile : false);
  const fileStats = useMemo(() => {
    if (!hasFileList || activeFileIsBinary || !code) return null;
    const lines = code.split('\n').length;
    return `${lines.toLocaleString()} line${lines === 1 ? '' : 's'} · ${formatBytes(utf8Length(code))}`;
  }, [hasFileList, activeFileIsBinary, code]);
  const svgUrl = useMemo(
    () => (isSvgText ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(code)}` : null),
    [isSvgText, code],
  );
  const binaryUrl = useMemo(
    () => (hasFileList && activeFileIsBinary && activeFile ? assetUrl?.(activeFile) || null : null),
    [hasFileList, activeFileIsBinary, activeFile, assetUrl],
  );

  const codeBody = (
    <div
      className="py-4 font-mono text-[13px] leading-relaxed whitespace-pre min-w-max text-[#cfd8f3]"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );

  // A transparent text area over the highlighted code: the user types into
  // the text area and sees the colours underneath. Both layers share the
  // `.code-editor-layer` class (font, padding, tab size, white-space) and the
  // same grid cell, so every character and the caret line up. The gutter is a
  // separate column, so it can't shift the text.
  const editorBody = isEditing && (
    <div className="code-editing flex min-w-max py-4 font-mono text-[13px] leading-relaxed">
      <div aria-hidden="true" className="code-editor-gutter">{editorLineNumbers}</div>
      <div className="code-editor-stack">
        <pre ref={editorLayerRef} aria-hidden="true" className="code-editor-layer" dangerouslySetInnerHTML={{ __html: editorHighlighted }} />
        <textarea
          ref={textareaRef}
          value={editing.draft}
          onChange={(e) => {
            const next = e.target.value;
            setEditing((cur) => ({ ...cur, draft: next }));
            // Only typing opens suggestions; deleting, pasting or a line
            // break closes them.
            const inputType = e.nativeEvent?.inputType || '';
            if (autocomplete && (inputType === 'insertText' || inputType === 'insertCompositionText')) updateSuggestions(e.target);
            else setSuggest(null);
          }}
          onMouseDown={() => setSuggest(null)}
          onBlur={() => setSuggest(null)}
          aria-autocomplete={autocomplete ? 'list' : undefined}
          aria-controls={suggest ? 'code-complete-list' : undefined}
          aria-expanded={autocomplete ? Boolean(suggest) : undefined}
          aria-activedescendant={suggest ? `code-complete-${suggest.index}` : undefined}
          onKeyDown={handleEditorKeyDown}
          // The box is always as big as its text (it shares the grid cell
          // with the <pre>), so any inner scroll is a browser nudge that
          // would slide the text away from the colours: undo it. The code
          // panel around it does the real scrolling.
          onScroll={(e) => { e.currentTarget.scrollTop = 0; e.currentTarget.scrollLeft = 0; }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          aria-label={`Edit the code of ${editTarget}`}
          className="code-editor-layer code-editor-input"
        />
        {suggest && (
          <ul id="code-complete-list" role="listbox" aria-label="Suggestions" className="code-complete" style={{ top: suggest.top, left: suggest.left }}>
            {suggest.items.map((word, i) => (
              <li
                key={word}
                id={`code-complete-${i}`}
                role="option"
                aria-selected={i === suggest.index}
                // mousedown, not click, and no focus change: the text area
                // keeps the caret where the word goes.
                onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(word); }}
                onMouseEnter={() => setSuggest((cur) => cur && { ...cur, index: i })}
              >
                <span className="code-complete-match">{word.slice(0, suggest.prefix.length)}</span>{word.slice(suggest.prefix.length)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <div className="code-view palette-stock min-w-0 w-full h-full bg-black rounded-lg overflow-hidden shadow-lg border border-neutral-800 flex flex-col">
      <div className="bg-black px-4 py-2 flex items-center border-b border-neutral-800 gap-2">
        {hasFileList ? (
          <button
            type="button"
            onClick={toggleExplorer}
            className="-ml-2 rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-200"
            title={explorerOpen ? 'Hide the file list' : 'Show the file list'}
            aria-label={explorerOpen ? 'Hide the file list' : 'Show the file list'}
            aria-pressed={explorerOpen}
          >
            {explorerOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
        ) : (
          <div className="flex space-x-1.5 mr-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]"></div>
          </div>
        )}
        {hasFileList && activeFile ? (
          <Breadcrumbs path={activeFile} onReveal={revealFolder} />
        ) : hasTabs ? (
          <div className="flex min-w-0 items-end gap-0.5 self-stretch -mb-2 overflow-x-auto custom-scrollbar" role="tablist" aria-label="Site pages">
            {pages.map((name) => {
              const isActive = name === activePage;
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => { if (name !== activePage) guard(onSelectPage)(name); }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 font-mono text-xs transition-colors ${
                    isActive
                      ? 'border-blue-400 bg-neutral-900 text-white'
                      : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  {name === writingPage && <Loader2 className="animate-spin text-blue-400" size={11} aria-label="Writing" />}
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-slate-400 font-mono truncate">{activePage}</span>
        )}
        <div className="flex-1"></div>
        {isSvgText && (
          <div className="flex shrink-0 rounded-md border border-neutral-800 p-0.5 text-xs" role="group" aria-label="Show SVG as">
            {[['Picture', false], ['Code', true]].map(([label, asCode]) => (
              <button
                key={label}
                type="button"
                onClick={() => setSvgAsCode(asCode)}
                aria-pressed={svgAsCode === asCode}
                className={`rounded px-2 py-0.5 ${svgAsCode === asCode ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {isEditing ? (
          <>
            {saveError && <span className="min-w-0 truncate text-xs text-red-400" role="alert" title={saveError}>{saveError}</span>}
            {isDirty && !saveError && <span className="shrink-0 text-xs text-amber-300">Unsaved changes</span>}
            <button
              type="button"
              onClick={cancelEditing}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white"
              title={isDirty ? 'Discard your changes' : 'Stop editing'}
            >
              <X size={14} />
              <span>Cancel</span>
            </button>
            <button
              type="button"
              onClick={saveEditing}
              disabled={saving || isGenerating || !isDirty}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              title={isGenerating ? 'Wait for the AI to finish before saving' : 'Save as a new version (Ctrl+S)'}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>Save</span>
            </button>
          </>
        ) : canEdit && (
          <button
            type="button"
            onClick={startEditing}
            disabled={isGenerating}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title={isGenerating ? 'Wait for the AI to finish before editing' : hasFileList ? 'Edit this file' : 'Edit this page\'s code'}
          >
            <Pencil size={14} />
            <span>Edit</span>
          </button>
        )}
        {code && !activeFileIsBinary && !isEditing && (
          <button
            onClick={onCopy}
            className={`flex shrink-0 items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
              copied
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/10'
            }`}
            title={hasFileList ? 'Copy this file\'s code' : 'Copy to clipboard'}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        )}
      </div>
      {hasFileList && activeFile && (
        <div className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-1.5 text-[11.5px]">
          <span className="min-w-0 truncate text-slate-400">{describeFile(activeFile, { entry: entryFile })}</span>
          {fileChanges[activeFile] && (
            <span className={`shrink-0 rounded px-1.5 py-px text-[10.5px] font-medium ${fileChanges[activeFile] === 'added' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-200'}`}>
              {fileChanges[activeFile] === 'added' ? 'New in the last edit' : 'Changed in the last edit'}
            </span>
          )}
          <div className="flex-1" />
          {fileStats && <span className="shrink-0 text-slate-600">{fileStats}</span>}
        </div>
      )}
      <div ref={containerRef} className="flex flex-1 min-h-0">
      {hasFileList && explorerOpen && (
        <>
          <div className="shrink-0 min-h-0" style={{ width: explorerWidth, maxWidth: '45%' }}>
            <FileExplorer
              files={files}
              activeFile={activeFile}
              onSelect={(path) => { if (path !== activeFile) guard(onSelectFile)(path); }}
              changes={fileChanges}
              entry={entryFile}
              projectKey={projectKey}
              revealRequest={revealRequest}
            />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the file list"
            aria-valuenow={explorerWidth}
            aria-valuemin={MIN_EXPLORER}
            aria-valuemax={MAX_EXPLORER}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={handleResizeKey}
            onDoubleClick={() => { setExplorerWidth(240); writeStored(EXPLORER_WIDTH_KEY, 240); }}
            title="Drag to resize · double-click to reset"
            className="w-1 shrink-0 cursor-col-resize border-r border-neutral-800 bg-neutral-950 outline-none hover:bg-blue-500/40 focus-visible:bg-blue-500/60"
          />
        </>
      )}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-w-0 overflow-auto bg-black custom-scrollbar">
        {isEditing ? editorBody : activeFileIsBinary ? (
          hasFileList ? <MediaPreview key={activeFile} path={activeFile} url={binaryUrl} /> : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 font-mono text-sm">
              <ImageIcon size={36} className="mb-3 text-slate-500" />
              <span>Image or font file — no code to show</span>
            </div>
          )
        ) : isSvgText && !svgAsCode ? (
          <MediaPreview key={activeFile} path={activeFile} url={svgUrl} />
        ) : code ? (
          <>
            {isGenerating && !hasFileList && (!writingPage || writingPage === activePage) && (
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-blue-500/20 bg-black/95 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-blue-300 backdrop-blur-sm">
                <Loader2 className="animate-spin" size={12} />
                <span>{writingPage ? `Streaming ${writingPage}` : 'Streaming'}</span>
              </div>
            )}
            {codeBody}
          </>
        ) : isGenerating && !hasFileList ? (
          <div className="flex items-center justify-center h-full space-x-2.5 text-blue-400 font-mono text-sm">
            <Loader2 className="animate-spin" size={16} />
            <span>Generating...</span>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 font-mono text-sm">
            <Code2 size={36} className="mb-3 text-slate-500" />
            <span>{hasFileList ? '// This file is empty' : '// No code yet'}</span>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
