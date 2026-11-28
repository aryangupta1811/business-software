import type { DeviceView, ReceiptSize } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEVICES_KEY, setDevicePrinting } from '../api/account';
import { SESSION_KEY } from '../api/session';
import { Select } from '../components/ui/select';

/**
 * How one counter computer prints (`02` #29, #30): its receipt paper and whether a bill prints
 * the moment it is saved. The printer belongs to the counter, not the business, so a shop can
 * have an 80 mm printer at one counter and a 58 mm one at another. Saved as soon as it changes.
 */
export function DevicePrinting({ device }: { device: DeviceView }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sizeId = useId();
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const { receiptSize, autoPrint } = device.printing;

  async function save(next: { receiptSize: ReceiptSize; autoPrint: boolean }) {
    setState('idle');
    try {
      const saved = await setDevicePrinting(device.id, next);
      queryClient.setQueryData<DeviceView[]>(DEVICES_KEY, (list) =>
        list?.map((row) => (row.id === saved.id ? saved : row)),
      );
      // This computer's own session carries the same two settings, for the counter.
      if (device.thisComputer) void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      setState('saved');
    } catch {
      setState('failed');
    }
  }

  return (
    <fieldset className="flex flex-wrap items-center gap-x-6 gap-y-2 pl-8">
      <legend className="sr-only">{t('account.devices.printing.title')}</legend>
      <label htmlFor={sizeId} className="flex items-center gap-2 text-label">
        <span className="text-muted">{t('account.devices.printing.receiptSize')}</span>
        <Select
          id={sizeId}
          className="h-8 w-auto py-0"
          value={String(receiptSize)}
          onChange={(event) => {
            void save({ receiptSize: event.target.value === '58' ? 58 : 80, autoPrint });
          }}
        >
          <option value="80">{t('account.devices.printing.size80')}</option>
          <option value="58">{t('account.devices.printing.size58')}</option>
        </Select>
      </label>
      <label className="flex items-center gap-2 text-label">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={autoPrint}
          onChange={(event) => {
            void save({ receiptSize, autoPrint: event.target.checked });
          }}
        />
        {t('account.devices.printing.autoPrint')}
      </label>
      <p className="basis-full text-label text-muted">
        {t('account.devices.printing.autoPrintHint')}
      </p>
      {state === 'saved' && (
        <p role="status" className="text-label text-success">
          {t('account.devices.printing.saved')}
        </p>
      )}
      {state === 'failed' && (
        <p role="alert" className="text-label text-danger">
          {t('account.devices.printing.failed')}
        </p>
      )}
    </fieldset>
  );
}
