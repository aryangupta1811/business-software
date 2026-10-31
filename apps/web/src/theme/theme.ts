export type Theme = 'light' | 'dark';

/** Also read by public/theme-init.js, which applies the theme before the app loads. */
export const THEME_STORAGE_KEY = 'theme';

/**
 * The theme chosen earlier on this computer, or light (the owner's default). Storage can
 * throw (blocked site data), so that means light too. Moves to the user's profile once
 * logins exist (P1.4).
 */
export function readSavedTheme(storage?: Pick<Storage, 'getItem'>): Theme {
  try {
    return (storage ?? localStorage).getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

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
