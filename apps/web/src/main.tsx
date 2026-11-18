import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
// Starts i18next in the saved language, so the first render is already translated.
import './i18n';
import { App } from './app';
import { createQueryClient } from './query-client';
import { createAppRouter } from './router';
import './styles.css';

// Zod speeds up a synchronous parse by compiling it with `new Function` after a test call. The
// CSP has no 'unsafe-eval', so that test call is refused and reported as a violation even
// though Zod catches it. Jitless skips the test; these forms are too small to notice.
z.config({ jitless: true });

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <App router={createAppRouter()} queryClient={createQueryClient()} />
  </StrictMode>,
);
