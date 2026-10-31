import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { changeLanguage } from '../i18n';
import { ThemeToggle } from './theme-toggle';

test('switches to dark and back, saying what it will do next', async () => {
  render(<ThemeToggle />);
  await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
  expect(document.documentElement).toHaveClass('dark');
  await userEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
  expect(document.documentElement).not.toHaveClass('dark');
});

test('starts from the theme already on the page', () => {
  document.documentElement.classList.add('dark');
  render(<ThemeToggle />);
  expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
});

test('its label is translated', async () => {
  await changeLanguage('hi');
  render(<ThemeToggle />);
  expect(screen.getByRole('button', { name: 'डार्क मोड चालू करें' })).toBeInTheDocument();
});
