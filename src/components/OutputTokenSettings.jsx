import { useState } from 'react';
import { SettingRow, FIELD_CLASS, SECONDARY_BUTTON } from './SettingControls';
import { loadOutputTokenLimit, saveOutputTokenLimit } from '../lib/config';

function OutputTokenLimit({ askMode = false, title, description }) {
  const [draft, setDraft] = useState(() => String(loadOutputTokenLimit(askMode) ?? ''));
  const [invalid, setInvalid] = useState(false);
  const id = askMode ? 'set-max-tokens-ask' : 'set-max-tokens-build';

  const changeLimit = (event) => {
    const input = event.target;
    const value = input.value === '' ? null : Number(input.value);
    const valid = !input.validity.badInput && (value === null || (Number.isSafeInteger(value) && value > 0));
    setDraft(input.value);
    setInvalid(!valid);
    if (valid) saveOutputTokenLimit(value, askMode);
  };

  const useProviderDefault = () => {
    setDraft('');
    setInvalid(false);
    saveOutputTokenLimit(null, askMode);
  };

  return (
    <SettingRow
      id={id}
      title={title}
      description={description}
      details={invalid && <p id={`${id}-error`} role="alert" className="text-xs text-red-600">Not saved. Enter a positive whole number or clear the field to use the provider default.</p>}
    >
      <div className="flex w-44 max-w-full flex-col items-start gap-2 sm:items-end">
        <input
          type="number"
          min="1"
          step="1"
          value={draft}
          onChange={changeLimit}
          placeholder="Provider default"
          aria-labelledby={id}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className={FIELD_CLASS}
        />
        {(draft !== '' || invalid) && <button type="button" onClick={useProviderDefault} className={SECONDARY_BUTTON} aria-label={`Use provider default for ${askMode ? 'Ask' : 'building'}`}>Use provider default</button>}
      </div>
    </SettingRow>
  );
}

export default function OutputTokenSettings() {
  return (
    <>
      <OutputTokenLimit title="Output tokens: building" description="Maximum tokens per response when building, editing, reviewing, or fixing code. Leave empty to let your AI provider choose. Thinking also uses this allowance." />
      <OutputTokenLimit askMode title="Output tokens: Ask" description="Maximum tokens per Ask response. Leave empty to let your AI provider choose. Changes are saved automatically." />
    </>
  );
}
