import { useState } from 'react';
import { X, Sparkles, Trash2, AlertTriangle, MessageSquarePlus, BoxSelect } from 'lucide-react';
import { ELEMENT_SHORTCUT_HINTS } from '../lib/shortcuts';

// Click-to-edit's bar for a group selection: several elements picked at once
// by dragging a box over the page or Shift+clicking. The direct-edit fields
// (image URL, link, fill) only make sense for one element, so a group gets
// what applies to all of them: describe a change for AI, or delete them
// together. Same dock, classes and key order as ElementToolbar; PreviewPane
// remounts it per selection.

export default function ElementGroupToolbar({
  group,
  isApplying = false,
  error = null,
  onAction,
  onEditWithAI,
  onCancel,
}) {
  const count = group.elements.length;
  const [aiInstruction, setAiInstruction] = useState('');

  const handleAiSend = (run) => {
    onEditWithAI(aiInstruction, { run });
  };

  return (
    <div
      className="element-bar"
      role="toolbar"
      aria-label={`Edit ${count} selected elements`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="element-bar-id">
        <span
          className="element-bar-count"
          data-tip={group.truncated
            ? `Only the first ${count} elements are selected. Drag a smaller box to pick fewer`
            : 'Shift+click an element to add or remove it, or Shift+drag to add more'}
        >
          <BoxSelect size={15} aria-hidden="true" />
          <span>{count} selected</span>
        </span>
      </div>
      <span className="chrome-divider element-bar-divider" aria-hidden="true" />

      <div className="element-bar-body">
        {error && (
          <p className="element-bar-message" title={error}>
            <AlertTriangle size={14} className="shrink-0" />
            <span>{error}</span>
          </p>
        )}
        <input
          type="text"
          value={aiInstruction}
          onChange={(e) => setAiInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleAiSend(Boolean(aiInstruction.trim()));
            }
          }}
          placeholder='Describe the change for all of them, e.g. "make these cards the same height"'
          aria-label="Describe the change for AI"
          className="element-bar-input element-bar-grow"
        />
      </div>

      <div className="element-bar-actions">
        <button
          type="button"
          onClick={() => handleAiSend(false)}
          className="nav-btn nav-ghost element-bar-btn"
          data-tip="Add these elements and your request to the chat box, to send later"
        >
          <MessageSquarePlus size={15} />
          <span>Add to chat</span>
        </button>
        <button
          type="button"
          onClick={() => handleAiSend(true)}
          disabled={!aiInstruction.trim()}
          className="nav-btn brand-fill-text preview-key bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
          data-tip="AI makes this change now, as a new version"
          data-tip-align="end"
        >
          <Sparkles size={15} />
          <span>Apply with AI</span>
        </button>
        <span className="chrome-divider element-bar-divider" aria-hidden="true" />
        <button
          type="button"
          onClick={() => onAction('delete')}
          disabled={isApplying}
          className="nav-btn nav-ghost nav-btn-icon element-bar-btn-icon element-bar-danger disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={`Delete ${count} elements`}
          data-tip={`Delete all ${count} (${ELEMENT_SHORTCUT_HINTS.delete})`}
          data-tip-align="end"
        >
          <Trash2 size={16} />
        </button>
        <span className="chrome-divider element-bar-divider" aria-hidden="true" />
        <button
          type="button"
          onClick={onCancel}
          className="nav-btn nav-ghost nav-btn-icon element-bar-btn-icon"
          aria-label="Clear selection"
          data-tip="Clear selection"
          data-tip-align="end"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
