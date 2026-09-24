import { Check, ChevronDown, FileText } from 'lucide-react';
import { pageLabel } from '../lib/pages';
import useDetailsDismiss from '../hooks/useDetailsDismiss';

// Toolbar page switcher for multi-page sites, shown in every device mode. A
// dropdown rather than a row of tabs: a site can have up to 12 pages, and the
// key has to fit the bar at every fold stage.
export default function PagePicker({ pages, activePage, onSelectPage }) {
  const detailsRef = useDetailsDismiss();
  const current = pageLabel(activePage);

  const choose = (name) => {
    if (detailsRef.current) detailsRef.current.open = false;
    if (name !== activePage) onSelectPage?.(name);
  };

  return (
    <details ref={detailsRef} className="preview-page-picker">
      <summary
        role="button"
        className="nav-btn nav-btn-secondary preview-page-picker-key"
        aria-label={`Page: ${current}. Switch page`}
        data-tip="Switch page"
      >
        <FileText size={16} />
        <span className="preview-page-picker-label">{current}</span>
        <ChevronDown size={14} className="preview-page-picker-chevron" />
      </summary>
      <div className="preview-page-menu bg-surface border border-slate-200 rounded-lg shadow-xl" role="group" aria-label="Site pages">
        {pages.map((name) => (
          <button
            key={name}
            type="button"
            aria-current={name === activePage ? 'page' : undefined}
            onClick={() => choose(name)}
            className={`preview-page-option${name === activePage ? ' is-active' : ''}`}
          >
            <span className="truncate">{pageLabel(name)}</span>
            {name === activePage && <Check size={14} />}
          </button>
        ))}
      </div>
    </details>
  );
}
