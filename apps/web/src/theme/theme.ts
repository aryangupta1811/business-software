export type Theme = 'light' | 'dark';

/**
 * Read only by public/theme-init.js, which applies the saved theme before the app loads; the
 * app then reads the class it set (`currentTheme`). Moves to the user's profile in P1.4.
 */
export const THEME_STORAGE_KEY = 'theme';

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not saved, so the next visit starts light; switching still works now.
  }
}
