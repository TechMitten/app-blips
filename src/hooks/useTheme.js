import { useState, useEffect } from 'react';
import { safeStorage, loadThemePreference, THEME_META_COLOR, THEME_KEY } from '../lib/config';

// Owns the theme preference and applies it to the document. `resolvedTheme`
// folds the 'system' preference together with the live OS setting.
export default function useTheme() {
  const [themePreference, setThemePreference] = useState(loadThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  );
  const resolvedTheme =
    themePreference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themePreference;

  // Stay subscribed even while an explicit light/dark preference is active, so
  // switching back to System applies the current OS setting immediately rather
  // than one render late.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return undefined;
    const handleChange = (event) => setSystemPrefersDark(event.matches);
    // Re-sync at mount in case the OS setting changed since the lazy initial
    // state was computed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSystemPrefersDark(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_META_COLOR[resolvedTheme]);
  }, [resolvedTheme]);

  useEffect(() => {
    try {
      safeStorage('local')?.setItem(THEME_KEY, themePreference);
    } catch {
      /* storage blocked -- the preference just will not persist */
    }
  }, [themePreference]);

  return { themePreference, setThemePreference, resolvedTheme };
}
