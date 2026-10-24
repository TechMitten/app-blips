import { useRef } from 'react';
import { CODE_LENGTH, cleanCode as clean } from '../lib/signInCode';

// One box per character that moves on as you type. `value` keeps a space for
// each empty box so a gap in the middle stays where it is. Pasting (or the
// browser's one-time-code autofill) spreads the code across the boxes.
export default function CodeInput({ value, onChange, label, invalid, autoFocus, disabled, className = '', boxClassName = '', onComplete }) {
  const refs = useRef([]);
  const chars = Array.from({ length: CODE_LENGTH }, (_, i) => (value[i] && value[i] !== ' ' ? value[i] : ''));

  const focusBox = (index) => {
    const box = refs.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))];
    box?.focus();
    box?.select();
  };
  const write = (next) => {
    const joined = next.map((c) => c || ' ').join('').trimEnd();
    onChange(joined);
    if (next.every(Boolean)) onComplete?.(joined);
  };
  // Puts `text` into the boxes starting at `start` and focuses the box after it.
  const fill = (start, text) => {
    const next = [...chars];
    const typed = clean(text).slice(0, CODE_LENGTH - start);
    for (let k = 0; k < typed.length; k += 1) next[start + k] = typed[k];
    write(next);
    focusBox(start + typed.length);
  };

  const onInput = (index, event) => {
    let typed = clean(event.target.value);
    // Typing into a filled box whose text wasn't selected adds a second
    // character next to the old one; keep only the new one.
    if (typed.length === 2 && chars[index] && typed.includes(chars[index])) typed = typed.replace(chars[index], '');
    if (!typed) {
      const next = [...chars];
      next[index] = '';
      write(next);
      return;
    }
    // A whole code arriving in one box (autofill) starts from the first box.
    fill(typed.length === CODE_LENGTH ? 0 : index, typed);
  };

  const onKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !chars[index] && index > 0) {
      event.preventDefault();
      const next = [...chars];
      next[index - 1] = '';
      write(next);
      focusBox(index - 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const onPaste = (index, event) => {
    const pasted = clean(event.clipboardData.getData('text'));
    if (!pasted) return;
    event.preventDefault();
    fill(pasted.length >= CODE_LENGTH ? 0 : index, pasted);
  };

  return (
    <div className={className} role="group" aria-label={label}>
      {chars.map((char, index) => (
        <input
          key={index}
          ref={(el) => { refs.current[index] = el; }}
          value={char}
          onChange={(event) => onInput(index, event)}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={(event) => onPaste(index, event)}
          onFocus={(event) => event.target.select()}
          aria-label={`${label}, character ${index + 1} of ${CODE_LENGTH}`}
          aria-invalid={invalid || undefined}
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          className={boxClassName}
        />
      ))}
    </div>
  );
}
