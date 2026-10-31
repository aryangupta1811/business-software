import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from '../app';
import { changeLanguage } from '../i18n';
import { createQueryClient } from '../query-client';
import { createAppRouter } from '../router';

function renderDesign() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/design'] }));
  render(<App router={router} queryClient={createQueryClient()} />);
}

const SECTIONS = [
  'Colours',
  'Text',
  'Buttons',
  'Inputs',
  'Badges',
  'Cards',
  'Keyboard keys',
  'Sample',
];

test('shows every part of the design system under its own heading', async () => {
  renderDesign();
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Design system');
  for (const name of SECTIONS) {
    expect(screen.getByRole('region', { name }), name).toBeInTheDocument();
  }
});

test('shows every button, including a disabled one', async () => {
  renderDesign();
  const region = await screen.findByRole('region', { name: 'Buttons' });
  const buttons = [...region.querySelectorAll('button')];
  expect(buttons.length).toBeGreaterThanOrEqual(6);
  expect(buttons.some((button) => button.disabled)).toBe(true);
});

test('shows an input in its error state, described for screen readers', async () => {
  renderDesign();
  expect(await screen.findByLabelText('Phone')).toHaveAccessibleDescription('Enter 10 digits');
});

test('is translated', async () => {
  await changeLanguage('hi');
  renderDesign();
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('डिज़ाइन सिस्टम');
  expect(screen.getByRole('region', { name: 'रंग' })).toBeInTheDocument();
});
