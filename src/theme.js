import { useEffect, useState } from 'react';

import { safeStorage } from './utils/storage';

const KEY = 'taycan_theme_mode';

/**
 * The app's light/dark/auto setting, shared by every root (#30).
 *
 * Extracted from App.jsx because the ledger and the place book mount INSTEAD
 * of App (see main.jsx), so App's copy of this never ran there — the two new
 * pages silently ignored the theme you picked and followed the OS instead.
 *
 * Applying `.dark` to <html> is what makes Tailwind's `dark:` variant follow
 * this setting rather than `prefers-color-scheme`; see the @custom-variant in
 * index.css. Without both halves, an explicit "light" leaves a dark page.
 */
export function useThemeMode() {
  const [themeMode, setThemeMode] = useState(() => safeStorage.get(KEY) || 'auto');
  // Tracked as state rather than read inline: in 'auto' the answer changes
  // when the OS does, and a plain read would not re-render.
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => setSystemDark(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  const darkMode = themeMode === 'auto' ? systemDark : themeMode === 'dark';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    safeStorage.set(KEY, themeMode);
  }, [darkMode, themeMode]);

  return { themeMode, setThemeMode, darkMode };
}
