import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Code2, Check, Copy, FileQuestion, Image as ImageIcon, Loader2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { syntaxHighlightHtml } from '../lib/helpers';
import { highlightSource } from '../lib/sourceHighlight';
import { describeFile, mediaKind } from '../lib/codebase/fileInfo';
import { formatBytes, utf8Length } from '../lib/codebase/paths';
import FileExplorer, { FileIcon } from './FileExplorer';

const EXPLORER_WIDTH_KEY = 'orion-file-explorer-width';
const EXPLORER_OPEN_KEY = 'orion-file-explorer-open';
const MIN_EXPLORER = 180;
const MAX_EXPLORER = 480;

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
    }).catch(() => { if (!cancelled) setInfo('This font could not be loaded for a preview.'); });
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

// Editor-styled read-only view of the generated (or streaming) HTML, or, for
// imported codebases, a file explorer beside the selected file.
export default function CodeView({
  code, isGenerating, copied, onCopy, autoFollow = true,
  pages = [], activePage = 'index.html', writingPage = null, onSelectPage,
  files = null, activeFile = null, activeFileIsBinary = false, onSelectFile,
  fileChanges = {}, entryFile = null, projectKey = 'default', assetUrl = null,
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
    () => (hasFileList ? highlightSource(code, activeFile) : syntaxHighlightHtml(code)),
    [code, hasFileList, activeFile],
  );
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
                  onClick={() => onSelectPage?.(name)}
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
        {code && !activeFileIsBinary && (
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
              onSelect={onSelectFile}
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
        {activeFileIsBinary ? (
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
