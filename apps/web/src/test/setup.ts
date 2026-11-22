import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { changeLanguage } from '../i18n';

// `findBy…` waits 1 s by default. A file's first render loads its route and translations,
// and while `pnpm check` runs every package's tests at once (database containers included)
// that took 1.5 s and failed a test that passes alone (seen 2026-11-19). A wrong page still
// fails, just later.
configure({ asyncUtilTimeout: 5000 });

// The router scrolls to the top on every navigation; jsdom has no layout, so no scrollTo.
window.scrollTo = () => undefined;

// jsdom has <dialog> but not its methods. Enough of the browser's behaviour for our
// dialogs: open, close with a close event, and Escape closing the open one.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener('keydown', (event) => {
    const open = document.querySelector('dialog[open]');
    if (event.key === 'Escape' && open instanceof HTMLDialogElement) open.close();
  });
}

// Testing Library only cleans up by itself when test globals are on; ours are off.
afterEach(async () => {
  cleanup();
  await changeLanguage('en');
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.classList.remove('dark');
});
