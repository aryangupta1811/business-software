import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Starts i18next in the saved language, so the first render is already translated.
import './i18n';
import { App } from './app';
import { createQueryClient } from './query-client';
import { createAppRouter } from './router';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <App router={createAppRouter()} queryClient={createQueryClient()} />
  </StrictMode>,
);
