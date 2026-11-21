import { STAFF_SWITCH_GROUPS, STAFF_SWITCHES, type StaffSwitch } from '@business-software/shared';
import { RotateCcw } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { defaultAccess, toggle, type Access } from './access';

/**
 * What this login may do (Module 00 #17, P1.5 design §6): the switches in their groups, each
 * with its dependent switches indented under it, and the percent box under "Give discounts".
 * The caller keeps the state and the Save button (`footer`); this only edits `value`.
 */
export function AccessCard({
  value,
  limitInvalid,
  onChange,
  footer,
}: {
  value: Access;
  /** The limit box holds something that isn't 0 to 100; shown after a try to save. */
  limitInvalid: boolean;
  onChange: (next: Access) => void;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-7 pt-6">
        <div className="flex flex-col gap-1">
          <CardTitle id={titleId}>{t('staff.access.title')}</CardTitle>
          <p className="text-muted">{t('staff.access.lead')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onChange(defaultAccess());
          }}
        >
          <RotateCcw aria-hidden="true" />
          {t('staff.access.reset')}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 px-7 pb-6">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
          {STAFF_SWITCH_GROUPS.map((group) => (
            <fieldset key={group} className="flex flex-col gap-3">
              <legend className="mb-1 text-label font-semibold tracking-wide text-muted uppercase">
                {t(`staff.groups.${group}`)}
              </legend>
              {STAFF_SWITCHES.filter((entry) => entry.group === group).map((entry) => (
                <SwitchRow
                  key={entry.permission}
                  entry={entry}
                  on={value.permissions.includes(entry.permission)}
                  onToggle={(on) => {
                    onChange(toggle(value, entry.permission, on));
                  }}
                >
                  {entry.permission === 'billing.discount' &&
                    value.permissions.includes('billing.discount') && (
                      <Field
                        label={t('staff.access.limit')}
                        hint={t('staff.access.limitHint')}
                        error={limitInvalid ? t('errors.fields.discountLimit.invalid') : undefined}
                      >
                        {(props) => (
                          <div className="flex items-center gap-2">
                            <Input
                              {...props}
                              inputMode="decimal"
                              autoComplete="off"
                              className="w-24 text-right tabular-nums"
                              value={value.limit}
                              onChange={(event) => {
                                onChange({ ...value, limit: event.target.value });
                              }}
                            />
                            <span aria-hidden="true" className="text-muted">
                              %
                            </span>
                          </div>
                        )}
                      </Field>
                    )}
                </SwitchRow>
              ))}
            </fieldset>
          ))}
        </div>
        <p className="rounded-lg bg-surface-muted px-4 py-3 text-muted">
          {t('staff.access.noMoney')}
        </p>
        {footer}
      </CardContent>
    </Card>
  );
}

/** One checkbox with its words; a switch that needs a parent is indented under it. */
function SwitchRow({
  entry,
  on,
  onToggle,
  children,
}: {
  entry: StaffSwitch;
  on: boolean;
  onToggle: (on: boolean) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const hintId = `${id}-hint`;
  const key = (part: 'label' | 'hint') => `staff.switches.${entry.permission}.${part}` as never;
  return (
    <div className={entry.parent === null ? 'flex flex-col gap-3' : 'ml-7 flex flex-col gap-3'}>
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          aria-describedby={hintId}
          className="mt-1 size-4 shrink-0 accent-primary"
          checked={on}
          onChange={(event) => {
            onToggle(event.target.checked);
          }}
        />
        <div className="flex flex-col">
          <label htmlFor={id} className="font-medium">
            {t(key('label'))}
          </label>
          <p id={hintId} className="text-label text-muted">
            {t(key('hint'))}
          </p>
        </div>
      </div>
      {children !== undefined && children !== false && <div className="ml-7">{children}</div>}
    </div>
  );
}
