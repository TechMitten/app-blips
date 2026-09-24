import { useEffect, useState } from 'react';

// Whole seconds since `since` (a Date.now() timestamp), ticking once a second
// while `since` is set; 0 when it isn't.
export default function useElapsedSeconds(since) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}
