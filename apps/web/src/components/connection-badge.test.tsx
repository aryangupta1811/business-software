import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createQueryClient } from '../query-client';
import { ConnectionBadge } from './connection-badge';

function renderBadge(fetchFn: typeof fetch) {
  vi.stubGlobal('fetch', fetchFn);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ConnectionBadge />
    </QueryClientProvider>,
  );
  return screen.getByRole('status');
}

test('shows checking first, then connected', async () => {
  const badge = renderBadge(
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'ok', database: 'ok' })),
  );
  expect(badge).toHaveTextContent('Checking connection');
  expect(await screen.findByText('Connected')).toBeInTheDocument();
});

test('shows server down when the API cannot be reached', async () => {
  renderBadge(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')));
  expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
});

test('shows database down when the API answers but its database does not', async () => {
  renderBadge(
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ status: 'error', database: 'unreachable' }, { status: 503 }),
      ),
  );
  expect(await screen.findByText("Server is up, but data can't be loaded")).toBeInTheDocument();
});
