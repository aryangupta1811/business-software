import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

test('renders into the page', () => {
  render(<p>Business Software</p>);
  expect(screen.getByText('Business Software')).toBeInTheDocument();
});
