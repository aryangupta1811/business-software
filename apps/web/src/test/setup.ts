import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { changeLanguage } from '../i18n';

// The router scrolls to the top on every navigation; jsdom has no layout, so no scrollTo.
window.scrollTo = () => undefined;

// Testing Library only cleans up by itself when test globals are on; ours are off.
afterEach(async () => {
  cleanup();
  await changeLanguage('en');
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
