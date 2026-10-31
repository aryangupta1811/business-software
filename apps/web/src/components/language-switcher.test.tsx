import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import { expect, test } from 'vitest';
import { LanguageSwitcher } from './language-switcher';

function Title() {
  const { t } = useTranslation();
  return <h1>{t('home.title')}</h1>;
}

function renderSwitcher() {
  render(
    <>
      <LanguageSwitcher />
      <Title />
    </>,
  );
}

test('offers each language in its own script, inside a labelled group', () => {
  renderSwitcher();
  const group = screen.getByRole('group', { name: 'Language' });
  expect(group).toBeInTheDocument();
  for (const name of ['English', 'हिन्दी', 'Hinglish']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
  expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'हिन्दी' })).toHaveAttribute('aria-pressed', 'false');
});

test('switching to Hindi changes the text and the page language', async () => {
  renderSwitcher();
  await userEvent.click(screen.getByRole('button', { name: 'हिन्दी' }));
  expect(screen.getByRole('heading')).toHaveTextContent('स्वागत है');
  expect(document.documentElement.lang).toBe('hi');
  expect(screen.getByRole('button', { name: 'हिन्दी' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('group', { name: 'भाषा' })).toBeInTheDocument();
});

test('switching to Hinglish shows Hindi in English letters', async () => {
  renderSwitcher();
  await userEvent.click(screen.getByRole('button', { name: 'Hinglish' }));
  expect(screen.getByRole('heading')).toHaveTextContent('Swagat hai');
  expect(document.documentElement.lang).toBe('hi-Latn');
});
