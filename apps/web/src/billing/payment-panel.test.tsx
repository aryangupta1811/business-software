import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { changeLanguage } from '../i18n';
import { ShortcutProvider } from '../shortcuts/shortcut-provider';
import { PaymentPanel } from './payment-panel';
import type { UdhaarAccess } from './udhaar-access';

const TOTAL = 14_150; // ₹141.50

function panel(props: {
  open: boolean;
  totalPaise: number;
  udhaar?: UdhaarAccess;
  onNeedCustomer?: () => void;
  onClose: () => void;
  onReady: () => void;
}) {
  return (
    <ShortcutProvider>
      <PaymentPanel {...props} />
    </ShortcutProvider>
  );
}

function open(props: { totalPaise?: number; udhaar?: UdhaarAccess } = {}) {
  const onClose = vi.fn();
  const onReady = vi.fn();
  const onNeedCustomer = vi.fn();
  const view = render(
    panel({
      open: true,
      totalPaise: props.totalPaise ?? TOTAL,
      ...(props.udhaar && { udhaar: props.udhaar }),
      onNeedCustomer,
      onClose,
      onReady,
    }),
  );
  return { onClose, onReady, onNeedCustomer, ...view };
}

const ACCOUNT: UdhaarAccess = {
  state: 'ready',
  customerName: 'Meena Stores',
  advancePaise: 0,
  standing: { balancePaise: 20_000, creditLimitPaise: 50_000 },
  who: 'owner',
  setting: 'warn',
};

const received = () => screen.getByRole('textbox', { name: 'Cash received' });
const alt = (key: string) => userEvent.keyboard(`{Alt>}${key}{/Alt}`);
const rows = () => screen.getAllByRole('group', { name: /^Payment \d$/ });

test('opens with one cash row for the whole bill, its amount focused and selected', () => {
  open();
  const dialog = screen.getByRole('dialog', { name: 'Payment' });
  expect(within(dialog).getByTestId('total')).toHaveTextContent('₹141.50');
  expect(received()).toHaveValue('141.50');
  expect(received()).toHaveFocus();
  expect((received() as HTMLInputElement).selectionStart).toBe(0);
  expect((received() as HTMLInputElement).selectionEnd).toBe(6);
  expect(screen.getByText('Fully paid')).toBeInTheDocument();
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
});

test('stays closed until it is opened', () => {
  render(panel({ open: false, totalPaise: TOTAL, onClose: vi.fn(), onReady: vi.fn() }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('shows the change to return when the customer hands over more cash', async () => {
  const { onReady } = open();
  await userEvent.keyboard('500');
  expect(screen.getAllByText('Change to return: ₹358.50')).not.toHaveLength(0);
  await userEvent.keyboard('{Enter}');
  expect(onReady).toHaveBeenCalledWith([
    { mode: 'cash', amountPaise: TOTAL, tenderedPaise: 50_000 },
  ]);
});

test('splits a bill between cash and UPI, the new row taking what is left', async () => {
  const { onReady } = open();
  await userEvent.keyboard('100');
  expect(screen.getByText('Left to pay')).toBeInTheDocument();
  expect(screen.getByTestId('left')).toHaveTextContent('₹41.50');
  await alt('a');
  const second = screen.getByRole('textbox', { name: 'Amount' });
  expect(second).toHaveValue('41.50');
  expect(second).toHaveFocus();
  expect(screen.getByRole('button', { name: /^UPI/, pressed: true })).toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox', { name: 'Reference (optional)' }), '4521');
  await userEvent.keyboard('{Enter}');
  expect(onReady).toHaveBeenCalledWith([
    { mode: 'cash', amountPaise: 10_000 },
    { mode: 'upi', amountPaise: 4_150, reference: '4521' },
  ]);
});

test('cannot finish while short, and says what is missing', async () => {
  const { onReady } = open();
  await userEvent.keyboard('100{Enter}');
  expect(onReady).not.toHaveBeenCalled();
  expect(screen.getByText('The payments must add up to the bill total')).toBeInTheDocument();
  expect(screen.getByTestId('left')).toHaveTextContent('₹41.50');
});

test('only cash can be more than what is left', async () => {
  const { onReady } = open();
  await alt('2');
  expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveFocus();
  await userEvent.keyboard('500');
  expect(screen.getByText('Only cash can be more than what’s left')).toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  expect(onReady).not.toHaveBeenCalled();
  await alt('1');
  expect(screen.queryByText('Only cash can be more than what’s left')).not.toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  expect(onReady).toHaveBeenCalledWith([
    { mode: 'cash', amountPaise: TOTAL, tenderedPaise: 50_000 },
  ]);
});

test('a cheque needs its number', async () => {
  const { onReady } = open();
  await alt('4');
  await userEvent.keyboard('{Enter}');
  expect(onReady).not.toHaveBeenCalled();
  expect(screen.getByText('Enter the cheque number')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox', { name: 'Cheque number' }), '000123');
  await userEvent.keyboard('{Enter}');
  expect(onReady).toHaveBeenCalledWith([
    { mode: 'cheque', amountPaise: TOTAL, reference: '000123' },
  ]);
});

test('Alt+1 to Alt+4 set the mode of the row being edited', async () => {
  open();
  for (const [key, name] of [
    ['2', /^UPI/],
    ['3', /^Card/],
    ['4', /^Cheque/],
    ['1', /^Cash/],
  ] as const) {
    await alt(key);
    expect(screen.getByRole('button', { name, pressed: true })).toBeInTheDocument();
  }
});

test('a plain number key sets the mode while a mode button has the focus', async () => {
  open();
  screen.getByRole('button', { name: /^Card/ }).focus();
  await userEvent.keyboard('2');
  expect(screen.getByRole('button', { name: /^UPI/, pressed: true })).toBeInTheDocument();
});

test('a mode key changes the row last used, not always the first', async () => {
  open();
  await userEvent.keyboard('100');
  await alt('a');
  await alt('3');
  expect(
    within(screen.getByRole('group', { name: 'Payment 1' })).getByRole('button', {
      name: /^Cash/,
      pressed: true,
    }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('group', { name: 'Payment 2' })).getByRole('button', {
      name: /^Card/,
      pressed: true,
    }),
  ).toBeInTheDocument();
});

test('rows can be added and removed; the first has no remove button', async () => {
  open();
  expect(screen.queryByRole('button', { name: /^Remove payment/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Add payment/ }));
  expect(rows()).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Remove payment 1' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Remove payment 2' }));
  expect(rows()).toHaveLength(1);
});

test('an amount that is not money is refused with a message', async () => {
  const { onReady } = open();
  await userEvent.keyboard('abc{Enter}');
  expect(screen.getByText('Enter an amount like 141.50')).toBeInTheDocument();
  expect(onReady).not.toHaveBeenCalled();
});

test('a split with a card sends every row in whole paise', async () => {
  const { onReady } = open({ totalPaise: 100_001 });
  await userEvent.keyboard('0.01');
  await alt('a');
  await alt('3');
  await userEvent.keyboard('{Enter}');
  expect(onReady).toHaveBeenCalledWith([
    { mode: 'cash', amountPaise: 1 },
    { mode: 'card', amountPaise: 100_000 },
  ]);
});

test('Escape calls onClose once', async () => {
  const { onClose } = open();
  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledOnce();
});

test('Cancel calls onClose once', async () => {
  const { onClose } = open();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledOnce();
});

test('reopening starts again with one cash row for the total', async () => {
  const props = { totalPaise: TOTAL, onClose: vi.fn(), onReady: vi.fn() };
  const { rerender } = render(panel({ open: true, ...props }));
  await userEvent.keyboard('100');
  await alt('a');
  expect(rows()).toHaveLength(2);
  rerender(panel({ open: false, ...props }));
  rerender(panel({ open: true, ...props }));
  expect(rows()).toHaveLength(1);
  expect(received()).toHaveValue('141.50');
  expect(props.onClose).not.toHaveBeenCalled();
});

test('speaks Hindi', async () => {
  await changeLanguage('hi');
  open();
  expect(screen.getByRole('dialog', { name: 'भुगतान' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'नकद मिला' })).toBeInTheDocument();
});

// ---- Udhaar and the advance (P1.18 design §5) ----

test('without udhaar rights the panel offers only the four ways of paying', () => {
  open();
  expect(screen.queryByRole('button', { name: /^Udhaar/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^From advance/ })).not.toBeInTheDocument();
});

test('with a customer, Udhaar is the fifth mode, on key 5, and takes no reference', async () => {
  const { onReady } = open({ udhaar: ACCOUNT });
  expect(screen.queryByRole('button', { name: /^From advance/ })).not.toBeInTheDocument();
  await userEvent.keyboard('{Alt>}1{/Alt}100');
  await alt('a');
  await alt('5');
  expect(screen.getByRole('button', { name: /^Udhaar/, pressed: true })).toBeInTheDocument();
  expect(screen.getByText("Goes on Meena Stores's account.")).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: /^Reference/ })).not.toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  expect(onReady).toHaveBeenCalledWith([
    { mode: 'cash', amountPaise: 10_000 },
    { mode: 'udhaar', amountPaise: 4_150 },
  ]);
});

test('a plain 5 sets the mode while a mode button has the focus', async () => {
  open({ udhaar: ACCOUNT });
  screen.getByRole('button', { name: /^Card/ }).focus();
  await userEvent.keyboard('5');
  expect(screen.getByRole('button', { name: /^Udhaar/, pressed: true })).toBeInTheDocument();
});

test('with no customer yet it says so and sends the cashier to add one', async () => {
  const { onNeedCustomer } = open({ udhaar: { ...ACCOUNT, state: 'needs_customer' } });
  expect(screen.queryByRole('button', { name: /^Udhaar/ })).not.toBeInTheDocument();
  await alt('5');
  expect(screen.getByRole('button', { name: /^Cash/, pressed: true })).toBeInTheDocument();
  expect(screen.getByText(/Udhaar needs a customer with a name and phone number/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /Add the customer's name and phone/ }));
  expect(onNeedCustomer).toHaveBeenCalledOnce();
});

test('From advance shows only with an advance, key 6, and never takes more than the advance', async () => {
  const { onReady } = open({
    totalPaise: 10_000,
    udhaar: {
      ...ACCOUNT,
      advancePaise: 3_000,
      standing: { balancePaise: -3_000, creditLimitPaise: null },
    },
  });
  await userEvent.keyboard('{Alt>}1{/Alt}');
  await alt('6');
  expect(screen.getByRole('button', { name: /^From advance/, pressed: true })).toBeInTheDocument();
  expect(screen.getByText('Advance available: ₹30.00.')).toBeInTheDocument();
  const amount = screen.getByRole('textbox', { name: 'Amount' });
  await userEvent.clear(amount);
  await userEvent.type(amount, '50');
  expect(screen.getByText('Only cash can be more than what’s left')).toBeInTheDocument();
  await userEvent.clear(amount);
  await userEvent.type(amount, '30');
  await alt('a');
  await userEvent.keyboard('{Enter}');
  expect(onReady).toHaveBeenCalledWith([
    { mode: 'advance', amountPaise: 3_000 },
    { mode: 'cash', amountPaise: 7_000 },
  ]);
});

test('warns the owner when the udhaar goes past the credit limit, but lets the bill save', async () => {
  const { onReady } = open({
    totalPaise: 40_000,
    udhaar: { ...ACCOUNT, standing: { balancePaise: 20_000, creditLimitPaise: 50_000 } },
  });
  await alt('5');
  expect(
    screen.getByText(/Over the credit limit: Meena Stores would owe ₹600.00, limit ₹500.00/),
  ).toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  expect(onReady).toHaveBeenCalledWith([{ mode: 'udhaar', amountPaise: 40_000 }]);
});

test('tells staff the owner is asked for a password when the udhaar goes past the limit', async () => {
  open({
    totalPaise: 40_000,
    udhaar: { ...ACCOUNT, who: 'staff' },
  });
  await alt('5');
  expect(screen.getByText(/The owner's password is asked when you press Done/)).toBeInTheDocument();
});

test('speaks Hindi about udhaar', async () => {
  await changeLanguage('hi');
  open({ udhaar: ACCOUNT });
  expect(screen.getByRole('button', { name: /^उधार/ })).toBeInTheDocument();
});
