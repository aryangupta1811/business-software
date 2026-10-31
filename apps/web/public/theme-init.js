// Applies the saved dark theme before the page is drawn, so a dark-mode user never sees a
// white flash. A separate file, not inline in index.html, because the CSP's
// script-src 'self' blocks inline scripts. Keep the key in step with src/theme/theme.ts.
try {
  if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
} catch {
  // Blocked storage: stay light.
}
