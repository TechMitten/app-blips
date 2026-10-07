import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

const MAX_LIST_HEIGHT = 320;
const EDGE_GAP = 12;
const LIST_GAP = 4;

// Every whitespace-separated term must appear in the model's name or id,
// so "claude sonnet" or "gpt mini" narrow things down naturally.
function filterModels(models, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return models;
  return models.filter((m) => {
    const haystack = `${m.label} ${m.id}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

export default function ModelCombobox({ value, onChange, models, loading = false, placeholder = 'Select a model…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const selected = models.find((m) => m.id === value);
  const results = useMemo(() => filterModels(models, query), [models, query]);

  const place = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportHeight = viewport?.height || window.innerHeight;
    const viewportWidth = viewport?.width || window.innerWidth;
    const topEdge = viewportTop + EDGE_GAP;
    const bottomEdge = viewportTop + viewportHeight - EDGE_GAP;
    const belowTop = Math.min(bottomEdge, Math.max(topEdge, rect.bottom + LIST_GAP));
    const aboveBottom = Math.max(topEdge, Math.min(bottomEdge, rect.top - LIST_GAP));
    const below = Math.max(0, bottomEdge - belowTop);
    const above = Math.max(0, aboveBottom - topEdge);
    const openUp = below < MAX_LIST_HEIGHT && above > below;
    const width = Math.min(rect.width, Math.max(0, viewportWidth - EDGE_GAP * 2));
    setPosition({
      left: Math.max(viewportLeft + EDGE_GAP, Math.min(rect.left, viewportLeft + viewportWidth - EDGE_GAP - width)),
      width,
      maxHeight: Math.min(MAX_LIST_HEIGHT, openUp ? above : below),
      boxSizing: 'border-box',
      ...(openUp ? { bottom: window.innerHeight - aboveBottom } : { top: belowTop }),
    });
  }, []);

  const openList = () => {
    if (open) return;
    place();
    setQuery('');
    setActive(Math.max(0, models.findIndex((m) => m.id === value)));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (model) => {
    onChange(model.id);
    close();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onScroll = (e) => { if (!listRef.current?.contains(e.target)) place(); };
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the keyboard-highlighted row visible while arrowing through the list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, position]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (results.length ? (i + step + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      if (results[active]) choose(results[active]);
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  const inputValue = open ? query : selected?.label || '';
  const inputPlaceholder = loading
    ? 'Loading models…'
    : open ? (selected?.label || 'Search models…') : placeholder;

  return (
    <div ref={wrapRef} className={`model-combobox${open ? ' is-open' : ''}`}>
      <Search size={15} className="model-combobox-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        value={inputValue}
        placeholder={inputPlaceholder}
        onChange={(e) => { if (!open) { place(); setOpen(true); } setQuery(e.target.value); setActive(0); }}
        onFocus={openList}
        onClick={openList}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        tabIndex={-1}
        className="model-combobox-toggle"
        aria-label={open ? 'Close model list' : 'Open model list'}
        onClick={() => { if (open) close(); else { inputRef.current?.focus(); openList(); } }}
      >
        <ChevronDown size={16} />
      </button>

      {open && position && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="model-combobox-list"
          style={{ position: 'fixed', ...position }}
          onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
        >
          {results.length === 0 ? (
            <li className="model-combobox-empty">{loading ? 'Loading models…' : `No models match “${query}”`}</li>
          ) : results.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={m.id === value}
              className={`model-combobox-option${i === active ? ' is-active' : ''}${m.id === value ? ' is-selected' : ''}`}
              onMouseMove={() => { if (i !== active) setActive(i); }}
              onClick={() => choose(m)}
            >
              <span className="model-combobox-text">
                <span className="model-combobox-label">{m.label}</span>
                <span className="model-combobox-id">{m.id}</span>
              </span>
              {m.id === value && <Check size={14} className="model-combobox-check" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
