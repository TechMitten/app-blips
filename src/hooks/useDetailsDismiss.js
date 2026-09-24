import { useEffect, useRef } from 'react';

// Closes a <details> dropdown on a pointer press outside it or on Escape
// (which also hands focus back to its summary). Returns the ref to attach.
export default function useDetailsDismiss() {
  const detailsRef = useRef(null);
  useEffect(() => {
    const dismiss = (event) => {
      const details = detailsRef.current;
      if (!details?.open) return;
      if (event.type === 'keydown') {
        if (event.key !== 'Escape') return;
        details.querySelector('summary')?.focus();
      } else if (details.contains(event.target)) return;
      details.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, []);
  return detailsRef;
}
