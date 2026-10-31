import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Field } from './field';
import { Input } from './input';
import { Kbd, KbdGroup } from './kbd';
import { Tooltip } from './tooltip';

test('a button is type="button" unless told otherwise', () => {
  render(
    <>
      <Button>Save</Button>
      <Button type="submit">Send</Button>
    </>,
  );
  expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit');
});

test('every button variant renders, and disabled disables', () => {
  render(
    <>
      {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
      <Button disabled>Off</Button>
    </>,
  );
  expect(screen.getAllByRole('button')).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'Off' })).toBeDisabled();
});

test('a field labels its input', () => {
  render(<Field label="Phone">{(props) => <Input {...props} />}</Field>);
  const input = screen.getByLabelText('Phone');
  expect(input).not.toHaveAttribute('aria-invalid');
  expect(input).not.toHaveAccessibleDescription();
});

test('a field with an error marks the input invalid and describes it', () => {
  render(
    <Field label="Phone" error="Enter 10 digits">
      {(props) => <Input {...props} />}
    </Field>,
  );
  const input = screen.getByLabelText('Phone');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('Enter 10 digits');
});

test('a card title is a level-2 heading', () => {
  render(
    <Card>
      <CardHeader>
        <CardTitle>Today</CardTitle>
      </CardHeader>
      <CardContent>₹12,450</CardContent>
    </Card>,
  );
  expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument();
});

test('key chips are kbd elements', () => {
  const { container } = render(
    <KbdGroup>
      <Kbd>Alt</Kbd>
      <Kbd>H</Kbd>
    </KbdGroup>,
  );
  expect([...container.querySelectorAll('kbd')].map((kbd) => kbd.textContent)).toEqual([
    'Alt',
    'H',
  ]);
});

test('a tooltip shows on keyboard focus', async () => {
  render(
    <Tooltip label="Switch to dark mode">
      <Button aria-label="Switch to dark mode">☾</Button>
    </Tooltip>,
  );
  await userEvent.tab();
  expect(await screen.findByRole('tooltip', { name: 'Switch to dark mode' })).toBeInTheDocument();
});
