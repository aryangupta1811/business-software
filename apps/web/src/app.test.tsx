import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './app';
import { createQueryClient } from './query-client';
import { createAppRouter } from './router';

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<App router={router} queryClient={createQueryClient()} />);
}

test('shows the home page at /', async () => {
  renderAt('/');
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Welcome');
});

test('shows the not-found page for an unknown path', async () => {
  renderAt('/no-such-page');
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
  expect(screen.getByRole('link', { name: 'Go to home' })).toHaveAttribute('href', '/');
});
