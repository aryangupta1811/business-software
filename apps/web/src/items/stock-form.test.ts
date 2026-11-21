import { expect, test, vi } from 'vitest';
import { ApiError } from '../api/client';
import {
  adjustmentBody,
  busyWaitMs,
  openingBody,
  quantityText,
  reasonsFor,
  sendStockChange,
} from './stock-form';

const KEY = '0b6f6f3e-3a3b-4c4d-8e8f-000000000009';

test('shows signed quantities without float noise', () => {
  expect(quantityText(12_500)).toBe('12.5');
  expect(quantityText(-500)).toBe('-0.5');
  expect(quantityText(-2_000)).toBe('-2');
  expect(quantityText(0)).toBe('0');
  expect(quantityText(1)).toBe('0.001');
});

test('only a count mismatch adds stock', () => {
  expect(reasonsFor('add')).toEqual(['count_mismatch']);
  expect(reasonsFor('remove')).toContain('damaged');
  expect(reasonsFor('remove')).toContain('count_mismatch');
});

test('waits as the header asks, at most 3 s, 1 s when it says nothing', () => {
  expect(busyWaitMs(0)).toBe(0);
  expect(busyWaitMs(2)).toBe(2_000);
  expect(busyWaitMs(60)).toBe(3_000);
  expect(busyWaitMs(undefined)).toBe(1_000);
});

test('an adjustment removes as a negative change and adds as a positive one', () => {
  const form = { direction: 'remove' as const, reason: 'damaged', quantity: '0.25', note: ' ' };
  expect(adjustmentBody(form, 'kg', KEY)).toEqual({
    body: { quantity: -250, reason: 'damaged', note: null, requestKey: KEY },
  });
  expect(
    adjustmentBody({ ...form, direction: 'add', reason: 'count_mismatch' }, 'kg', KEY),
  ).toEqual({ body: { quantity: 250, reason: 'count_mismatch', note: null, requestKey: KEY } });
});

test('an adjustment names every field that is wrong', () => {
  expect(
    adjustmentBody({ direction: 'remove', reason: '', quantity: '', note: '' }, 'kg', KEY),
  ).toEqual({ errors: { quantity: 'required', reason: 'choose' } });
  expect(
    adjustmentBody({ direction: 'remove', reason: 'other', quantity: '2.5', note: '' }, 'box', KEY),
  ).toEqual({ errors: { quantity: 'whole_units_only', note: 'required' } });
  expect(
    adjustmentBody({ direction: 'remove', reason: 'expired', quantity: '0', note: '' }, 'kg', KEY),
  ).toEqual({ errors: { quantity: 'too_small' } });
});

test('opening stock sends the cost in paise only when the form has the field', () => {
  expect(openingBody({ quantity: '10', unitCost: '45.50' }, 'piece', KEY)).toEqual({
    body: { quantity: 10_000, unitCost: 4_550, requestKey: KEY },
  });
  expect(openingBody({ quantity: '10' }, 'piece', KEY)).toEqual({
    body: { quantity: 10_000, requestKey: KEY },
  });
  expect(openingBody({ quantity: 'ten', unitCost: '' }, 'piece', KEY)).toEqual({
    errors: { quantity: 'invalid', unitCost: 'required' },
  });
});

test('a busy answer is tried once more, the same way; anything else is not', async () => {
  const busy = new ApiError(503, 'busy', {}, undefined, {}, 0);
  const send = vi.fn().mockRejectedValueOnce(busy).mockResolvedValueOnce('saved');
  await expect(sendStockChange(send)).resolves.toBe('saved');
  expect(send).toHaveBeenCalledTimes(2);

  const twice = vi.fn().mockRejectedValue(busy);
  await expect(sendStockChange(twice)).rejects.toBe(busy);
  expect(twice).toHaveBeenCalledTimes(2);

  const refused = new ApiError(409, 'below_zero');
  const once = vi.fn().mockRejectedValue(refused);
  await expect(sendStockChange(once)).rejects.toBe(refused);
  expect(once).toHaveBeenCalledTimes(1);
});
