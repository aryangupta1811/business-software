import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useEffect, useRef } from 'react';
import { expect, test, vi } from 'vitest';
import { changeLanguage } from '../i18n';
import { ShortcutProvider } from './shortcut-provider';
import { useShortcut } from './use-shortcut';

function GoHome({ action }: { action: () => void }) {
  useShortcut({ keys: 'Alt+H', description: 'shortcuts.goHome', group: 'navigation', action });
  return null;
}

function renderWith(action = vi.fn(), withChild = true) {
  return render(<ShortcutProvider>{withChild && <GoHome action={action} />}</ShortcutProvider>);
}

const openHelp = () => userEvent.keyboard('?');
const pressAltH = () => userEvent.keyboard('{Alt>}h{/Alt}');

test('? opens the help panel, listing the shortcuts by group with their keys', async () => {
  renderWith();
  await openHelp();
  const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
  const navigation = within(dialog).getByRole('region', { name: 'Navigation' });
  expect(navigation).toHaveTextContent('Go to Home');
  expect(navigation).toHaveTextContent('AltH');
  expect(within(dialog).getByRole('region', { name: 'General' })).toHaveTextContent(
    'Show keyboard shortcuts',
  );
});

test('Escape closes the help panel', async () => {
  renderWith();
  await openHelp();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('the close button closes the help panel', async () => {
  renderWith();
  await openHelp();
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('no other shortcut fires while the help panel is open', async () => {
  const action = vi.fn();
  renderWith(action);
  await openHelp();
  await pressAltH();
  expect(action).not.toHaveBeenCalled();
});

test('a shortcut works while its component is on screen', async () => {
  const action = vi.fn();
  renderWith(action);
  await pressAltH();
  expect(action).toHaveBeenCalledOnce();
});

test('a shortcut leaves the list when its component leaves the screen', async () => {
  const { rerender } = renderWith();
  rerender(<ShortcutProvider>{null}</ShortcutProvider>);
  await openHelp();
  expect(screen.getByRole('dialog')).not.toHaveTextContent('Go to Home');
});

test("StrictMode's double mount registers once, with no false clash", async () => {
  const action = vi.fn();
  render(
    <StrictMode>
      <ShortcutProvider>
        <GoHome action={action} />
      </ShortcutProvider>
    </StrictMode>,
  );
  await pressAltH();
  expect(action).toHaveBeenCalledOnce();
});

test('the help panel speaks the current language', async () => {
  await changeLanguage('hi');
  renderWith();
  await openHelp();
  expect(screen.getByRole('dialog', { name: 'कीबोर्ड शॉर्टकट' })).toBeInTheDocument();
});

/** A modal dialog (the browser's, as ADR 0026) with a key of its own, like a billing dialog. */
function PayDialog({ onPay }: { onPay: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useShortcut({
    keys: 'F10',
    description: 'shortcuts.goHome',
    group: 'general',
    action: onPay,
    inDialog: true,
  });
  return (
    <dialog ref={dialog} aria-label="Pay">
      <button>Cash</button>
    </dialog>
  );
}

test('any open dialog pauses the page’s shortcuts, and its own keys work', async () => {
  const home = vi.fn();
  const pay = vi.fn();
  render(
    <ShortcutProvider>
      <GoHome action={home} />
      <PayDialog onPay={pay} />
    </ShortcutProvider>,
  );
  await pressAltH();
  await userEvent.keyboard('{F10}');
  expect(home).not.toHaveBeenCalled();
  expect(pay).toHaveBeenCalledOnce();
});

test('? does not open the help panel on top of another dialog', async () => {
  render(
    <ShortcutProvider>
      <PayDialog onPay={vi.fn()} />
    </ShortcutProvider>,
  );
  await openHelp();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
});
