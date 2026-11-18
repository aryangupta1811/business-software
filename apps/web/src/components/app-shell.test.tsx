import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { App } from '../app';
import { createQueryClient } from '../query-client';
import { createAppRouter } from '../router';

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<App router={router} queryClient={createQueryClient()} />);
}

test('the sidebar links to Home, marked as the current page', async () => {
  renderAt('/');
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  expect(within(nav).getByRole('link', { name: /Home/ })).toHaveAttribute('aria-current', 'page');
});

test('Alt+H goes Home from any page', async () => {
  renderAt('/no-such-page');
  await screen.findByRole('heading', { level: 1, name: 'Page not found' });
  await userEvent.keyboard('{Alt>}h{/Alt}');
  expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
});

test('a visible button opens the keyboard shortcuts, for mouse users', async () => {
  renderAt('/');
  await userEvent.click(await screen.findByRole('button', { name: 'Keyboard shortcuts' }));
  expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
});

test('the top bar has the language switcher and the theme button', async () => {
  renderAt('/');
  expect(await screen.findByRole('group', { name: 'Language' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
});

test('the Home link announces its shortcut to screen readers', async () => {
  renderAt('/');
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  expect(within(nav).getByRole('link', { name: /Home/ })).toHaveAttribute(
    'aria-keyshortcuts',
    'Alt+H',
  );
});

// jsdom has no layout, so these check the classes that give the behaviour.
test('the sidebar and top bar stay in view, and grow with long Hindi text', async () => {
  renderAt('/');
  const header = await screen.findByRole('banner');
  expect(header).toHaveClass('sticky', 'min-h-14');
  expect(header).not.toHaveClass('h-14');
  expect(screen.getByRole('complementary')).toHaveClass('sticky', 'h-screen');
  const home = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
    name: /Home/,
  });
  expect(home).toHaveClass('min-h-10');
  expect(home).not.toHaveClass('h-10');
});
