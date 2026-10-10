import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight, ChevronsDownUp, File, FileAudio, FileCode2, FileCog, FileImage, FileJson, FileText,
  FileType, FileVideo, Folder, FolderOpen, Lock, Package, Palette, Search, Sparkles, X,
} from 'lucide-react';
import { buildFileTree, describeFile, describeFolder, parentFolders } from '../lib/codebase/fileInfo';
import { extensionOf, isLockfile } from '../lib/codebase/paths';

// Which folders are open, per project. Module-level so switching between the
// Browser and Code tabs (which remounts the code view) keeps the tree as the
// user left it.
const expandedByProject = new Map();

function iconFor(path) {
  const name = path.split('/').pop();
  const ext = extensionOf(path);
  if (name === 'package.json') return { Icon: Package, color: 'text-red-400' };
  if (isLockfile(path)) return { Icon: Lock, color: 'text-slate-500' };
  if (/\.config\.[cm]?[jt]s$|^tsconfig|^\.eslintrc|^\.gitignore$|^\.env/.test(name)) return { Icon: FileCog, color: 'text-slate-400' };
  if (ext === 'tsx' || ext === 'jsx') return { Icon: FileCode2, color: 'text-sky-400' };
  if (['ts', 'mts', 'cts'].includes(ext)) return { Icon: FileCode2, color: 'text-blue-400' };
  if (['js', 'mjs', 'cjs'].includes(ext)) return { Icon: FileCode2, color: 'text-yellow-300' };
  if (['css', 'scss', 'less'].includes(ext)) return { Icon: Palette, color: 'text-pink-400' };
  if (ext === 'json') return { Icon: FileJson, color: 'text-amber-300' };
  if (ext === 'html') return { Icon: FileCode2, color: 'text-orange-400' };
  if (['md', 'txt'].includes(ext)) return { Icon: FileText, color: 'text-slate-300' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'svg'].includes(ext)) return { Icon: FileImage, color: 'text-emerald-400' };
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return { Icon: FileType, color: 'text-teal-300' };
  if (['mp4', 'webm'].includes(ext)) return { Icon: FileVideo, color: 'text-rose-300' };
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return { Icon: FileAudio, color: 'text-rose-300' };
  return { Icon: File, color: 'text-slate-400' };
}

export function FileIcon({ path, size = 14 }) {
  const { Icon, color } = iconFor(path);
  return <Icon size={size} className={`shrink-0 ${color}`} aria-hidden="true" />;
}

function Highlight({ text, query }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-amber-400/25 text-amber-100">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

function ChangeBadge({ status }) {
  if (!status) return null;
  return status === 'added'
    ? <span className="ml-auto shrink-0 rounded px-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300 bg-emerald-500/15" title="Added by the last edit">New</span>
    : <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Changed by the last edit" />;
}

// Folder tree of an imported codebase, with search, plain-English tooltips,
// "changed by the last edit" markers and full keyboard navigation (arrow
// keys, Home/End, Enter), following the WAI-ARIA tree pattern.
export default function FileExplorer({ files, activeFile, onSelect, changes = {}, entry = null, projectKey = 'default', revealRequest = null }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => expandedByProject.get(projectKey) || new Set(['src', ...parentFolders(activeFile)]));
  const [focusedId, setFocusedId] = useState(null);
  const [showChanges, setShowChanges] = useState(true);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const q = query.trim().toLowerCase();

  useEffect(() => { expandedByProject.set(projectKey, expanded); }, [projectKey, expanded]);

  // Opening a file (from search, the changed list or a breadcrumb) reveals it
  // in the tree: its folders open during render, then it scrolls into view.
  const revealTarget = revealRequest?.path ?? activeFile;
  const revealKey = revealTarget ? `${revealRequest?.isFolder ? 'd' : 'f'}:${revealTarget}:${revealRequest?.at ?? ''}` : null;
  const [revealedKey, setRevealedKey] = useState(null);
  if (revealKey && revealKey !== revealedKey) {
    setRevealedKey(revealKey);
    const folders = revealRequest?.isFolder ? [...parentFolders(revealTarget), revealTarget] : parentFolders(revealTarget);
    if (!folders.every((f) => expanded.has(f))) setExpanded(new Set([...expanded, ...folders]));
  }
  useEffect(() => {
    if (!revealTarget) return;
    const id = revealRequest?.isFolder ? `d:${revealTarget}` : `f:${revealTarget}`;
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }, [revealTarget, revealRequest]);

  const tree = useMemo(() => buildFileTree(files), [files]);

  // The rows currently on screen, in order: the keyboard model walks this.
  const rows = useMemo(() => {
    if (q) {
      return files
        .filter((f) => f.toLowerCase().includes(q))
        // Name matches first: typing "button" should find button.tsx before
        // every file inside a buttons/ folder.
        .sort((a, b) => Number(!a.split('/').pop().toLowerCase().includes(q)) - Number(!b.split('/').pop().toLowerCase().includes(q)))
        .map((path) => ({ id: `f:${path}`, type: 'file', path, depth: 0 }));
    }
    const out = [];
    const walk = (node, depth) => {
      for (const folder of node.folders) {
        const open = expanded.has(folder.path);
        out.push({ id: `d:${folder.path}`, type: 'folder', path: folder.path, name: folder.name, depth, open, parent: node.path });
        if (open) walk(folder, depth + 1);
      }
      for (const path of node.files) out.push({ id: `f:${path}`, type: 'file', path, depth, parent: node.path });
    };
    walk(tree, 0);
    return out;
  }, [q, files, tree, expanded]);

  const changedList = useMemo(() => Object.keys(changes).filter((p) => files.includes(p)).sort(), [changes, files]);
  // Folders holding changed files get a dot too, so changes are findable
  // with the tree collapsed.
  const changedFolders = useMemo(() => new Set(changedList.flatMap(parentFolders)), [changedList]);

  const toggle = (path, open) => setExpanded((prev) => {
    const next = new Set(prev);
    if (open ?? !next.has(path)) next.add(path); else next.delete(path);
    return next;
  });

  const activate = (row) => {
    if (row.type === 'folder') toggle(row.path);
    else onSelect?.(row.path);
  };

  const focusRow = (id) => {
    setFocusedId(id);
    listRef.current?.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.focus();
  };

  const currentId = rows.some((r) => r.id === focusedId) ? focusedId : (rows.find((r) => r.path === activeFile)?.id ?? rows[0]?.id);

  const handleTreeKey = (e) => {
    const index = rows.findIndex((r) => r.id === currentId);
    const row = rows[index];
    if (!row) return;
    const move = (to) => { e.preventDefault(); const r = rows[Math.max(0, Math.min(rows.length - 1, to))]; if (r) focusRow(r.id); };
    switch (e.key) {
      case 'ArrowDown': return move(index + 1);
      case 'ArrowUp':
        if (index === 0 && q) { e.preventDefault(); searchRef.current?.focus(); return undefined; }
        return move(index - 1);
      case 'Home': return move(0);
      case 'End': return move(rows.length - 1);
      case 'ArrowRight':
        if (row.type === 'folder') { e.preventDefault(); if (!row.open) toggle(row.path, true); else move(index + 1); }
        return undefined;
      case 'ArrowLeft':
        e.preventDefault();
        if (row.type === 'folder' && row.open) toggle(row.path, false);
        else if (row.parent) focusRow(`d:${row.parent}`);
        return undefined;
      case 'Enter':
      case ' ':
        e.preventDefault();
        activate(row);
        return undefined;
      case 'Escape':
        if (q) { e.preventDefault(); setQuery(''); searchRef.current?.focus(); }
        return undefined;
      default:
        // Typing a letter jumps into search, like most file pickers.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
          e.preventDefault();
          setQuery((prev) => prev + e.key);
          searchRef.current?.focus();
        }
        return undefined;
    }
  };

  const handleSearchKey = (e) => {
    if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); }
    else if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); focusRow(rows[0].id); }
    else if (e.key === 'Enter' && q && rows[0]) { e.preventDefault(); onSelect?.(rows[0].path); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-950">
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Files</span>
        <span className="text-[11px] text-slate-600">{files.length}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setExpanded(new Set())}
          className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-200"
          title="Collapse all folders"
          aria-label="Collapse all folders"
        >
          <ChevronsDownUp size={13} />
        </button>
      </div>
      <label className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-slate-400 focus-within:border-blue-500/60">
        <Search size={13} aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKey}
          placeholder="Search files…"
          aria-label="Search files"
          className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-500"
        />
        {query && (
          <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} className="text-slate-500 hover:text-slate-200" aria-label="Clear search">
            <X size={12} />
          </button>
        )}
      </label>

      <div ref={listRef} className="flex-1 overflow-y-auto pb-2 custom-scrollbar">
        {!q && changedList.length > 0 && (
          <div className="mb-1 border-b border-neutral-800 pb-1">
            <button
              type="button"
              onClick={() => setShowChanges((v) => !v)}
              aria-expanded={showChanges}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-amber-200/90 hover:bg-white/5"
            >
              <ChevronRight size={12} className={`transition-transform ${showChanges ? 'rotate-90' : ''}`} aria-hidden="true" />
              <Sparkles size={12} aria-hidden="true" />
              Changed in the last edit
              <span className="ml-auto font-normal text-slate-500">{changedList.length}</span>
            </button>
            {showChanges && changedList.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => onSelect?.(path)}
                title={`${path}\n${describeFile(path, { entry })}`}
                className={`flex w-full items-center gap-1.5 py-1 pl-7 pr-2 text-left text-xs ${path === activeFile ? 'bg-blue-500/15 text-white' : 'text-slate-300 hover:bg-white/5'}`}
              >
                <FileIcon path={path} size={13} />
                <span className="truncate">{path.split('/').pop()}</span>
                <span className="min-w-0 truncate text-[10.5px] text-slate-600">{parentFolders(path).pop() || ''}</span>
                <ChangeBadge status={changes[path]} />
              </button>
            ))}
          </div>
        )}

        <ul role="tree" aria-label="Project files" onKeyDown={handleTreeKey}>
          {rows.map((row) => {
            const isActive = row.type === 'file' && row.path === activeFile;
            const tabIndex = row.id === currentId ? 0 : -1;
            const indent = { paddingLeft: `${8 + row.depth * 14}px` };
            if (row.type === 'folder') {
              const note = describeFolder(row.path);
              return (
                <li
                  key={row.id}
                  role="treeitem"
                  aria-expanded={row.open}
                  aria-level={row.depth + 1}
                  data-row-id={row.id}
                  tabIndex={tabIndex}
                  onFocus={() => setFocusedId(row.id)}
                  onClick={() => { setFocusedId(row.id); toggle(row.path); }}
                  title={note ? `${row.name}/ — ${note}` : `${row.name}/`}
                  style={indent}
                  className="flex cursor-pointer select-none items-center gap-1 py-[3px] pr-2 text-[12.5px] text-slate-300 outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500"
                >
                  <ChevronRight size={12} className={`shrink-0 text-slate-500 transition-transform ${row.open ? 'rotate-90' : ''}`} aria-hidden="true" />
                  {row.open
                    ? <FolderOpen size={14} className="shrink-0 text-amber-300/80" aria-hidden="true" />
                    : <Folder size={14} className="shrink-0 text-amber-300/80" aria-hidden="true" />}
                  <span className="truncate">{row.name}</span>
                  {!row.open && changedFolders.has(row.path) && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70" title="Contains files changed by the last edit" />}
                </li>
              );
            }
            const name = row.path.split('/').pop();
            const folder = parentFolders(row.path).pop();
            return (
              <li
                key={row.id}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={isActive}
                aria-current={isActive ? 'true' : undefined}
                data-row-id={row.id}
                tabIndex={tabIndex}
                onFocus={() => setFocusedId(row.id)}
                onClick={() => { setFocusedId(row.id); onSelect?.(row.path); }}
                title={`${row.path}\n${describeFile(row.path, { entry })}`}
                style={q ? undefined : { paddingLeft: `${8 + row.depth * 14 + 13}px` }}
                className={`flex cursor-pointer select-none items-center gap-1.5 py-[3px] pr-2 text-[12.5px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                  q ? 'pl-3' : ''
                } ${isActive ? 'bg-blue-500/15 text-white shadow-[inset_2px_0_0] shadow-blue-400' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
              >
                <FileIcon path={row.path} />
                {q ? (
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate"><Highlight text={name} query={q} /></span>
                    {folder && <span className="truncate text-[10.5px] text-slate-600"><Highlight text={folder} query={q} /></span>}
                  </span>
                ) : (
                  <span className="truncate">{name}</span>
                )}
                {row.path === entry && <span className="shrink-0 rounded bg-white/5 px-1 text-[10px] text-slate-500" title="The app starts here">start</span>}
                <ChangeBadge status={changes[row.path]} />
              </li>
            );
          })}
        </ul>
        {q && !rows.length && (
          <p className="px-3 py-4 text-center text-xs text-slate-500">
            No files match “{query.trim()}”.
          </p>
        )}
      </div>
    </div>
  );
}
