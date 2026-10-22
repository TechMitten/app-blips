import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import useAnchoredList from '../hooks/useAnchoredList';

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

// `canOpen`, when given, is asked before the list opens; returning false keeps
// it closed (the caller explains why, e.g. no API key yet).
export default function ModelCombobox({ value, onChange, models, loading = false, allowCustom = false, placeholder = 'Select a model…', canOpen }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const [position, place] = useAnchoredList(wrapRef, listRef, open);

  const selected = models.find((m) => m.id === value);
  const results = useMemo(() => {
    const matches = filterModels(models, query);
    const custom = query.trim();
    return allowCustom && custom && !models.some((model) => model.id === custom)
      ? [...matches, { id: custom, label: `Use “${custom}”` }]
      : matches;
  }, [models, query, allowCustom]);

  const openList = () => {
    if (open || canOpen?.() === false) return;
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

  const inputValue = open ? query : selected?.label || value || '';
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
        onChange={(e) => { if (!open) { if (canOpen?.() === false) return; place(); setOpen(true); } setQuery(e.target.value); setActive(0); }}
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
