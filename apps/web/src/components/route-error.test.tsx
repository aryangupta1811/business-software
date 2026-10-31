import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { changeLanguage } from '../i18n';
import { RouteError } from './route-error';

test('explains the problem in the chosen language and offers a reload', async () => {
  await changeLanguage('hi');
  render(<RouteError />);
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('कुछ गड़बड़ हो गई');
  expect(screen.getByRole('button', { name: 'पेज दोबारा लोड करें' })).toBeInTheDocument();
});
