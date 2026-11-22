import {
  formatPaise,
  type BranchStockView,
  type BuiltInUnit,
  type FieldErrors,
  type ItemsContext,
  type ItemView,
  type MovementView,
} from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  useForm,
  useWatch,
  type FieldPath,
  type FieldValues,
  type UseFormSetError,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ApiError, apiRequest } from '../api/client';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ChoiceCards } from '../components/ui/choice-cards';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { useBranchScope } from '../branches/branch-scope-context';
import { useFieldError } from '../lib/field-error';
import { itemKeys, useItemStock, useMovements } from './api';
import { rupeesText } from './item-form';
import { unitName } from './labels';
import {
  adjustmentBody,
  openingBody,
  reasonsFor,
  sendStockChange,
  stockText,
  type AdjustForm,
  type OpeningForm,
} from './stock-form';

/**
 * Below zero and out of stock in red, low in amber (design §11); nothing when there's enough.
 * The badge always has words, so colour is never the only sign.
 */
export function StockBadge({ quantity, low }: { quantity: number; low: boolean }) {
  const { t } = useTranslation();
  const state = quantity < 0 ? 'negative' : quantity === 0 ? 'out' : low ? 'low' : null;
  if (state === null) return null;
  return (
    <Badge tone={state === 'low' ? 'warning' : 'danger'}>{t(`items.stock.badges.${state}`)}</Badge>
  );
}

type Dialog = 'opening' | 'adjust' | null;

/**
 * An item's stock at each branch, the changes the caller may make at their own branch, and the
 * history (design §11). Outside the item form: each change saves at once, with its own key.
 */
export function StockPanel({ item, context }: { item: ItemView; context: ItemsContext }) {
  const { t } = useTranslation();
  const titleId = useId();
  // The owner's branch picker (P1.6): it changes what is shown, never where a change is saved.
  const scope = useBranchScope();
  const stock = useItemStock(item.id, true, scope.param);
  const [dialog, setDialog] = useState<Dialog>(null);
  const showCost = context.canViewCost;
  const mine = stock.data?.branches.find((row) => row.branchId === context.branchId);
  const canChange = context.canAdjustStock && !item.archived && mine !== undefined;
  const elsewhere =
    scope.param !== undefined && scope.param !== context.branchId && mine === undefined;

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="flex flex-col gap-1 px-7 pt-6">
        <CardTitle id={titleId}>{t('items.stock.title')}</CardTitle>
        <p className="text-muted">{t('items.stock.lead')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 px-7 pb-6">
        {stock.isPending && <p className="text-muted">{t('items.loading')}</p>}
        {stock.isError && (
          <div role="alert" className="flex items-center gap-3">
            <p>{t('items.stock.loadFailed')}</p>
            <Button variant="secondary" size="sm" onClick={() => void stock.refetch()}>
              {t('items.retry')}
            </Button>
          </div>
        )}
        {stock.data && (
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">{t('items.stock.title')}</caption>
            <thead className="border-b border-border text-label text-muted">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('items.stock.branch')}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('items.stock.quantity')}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('items.stock.level')}
                </th>
                {showCost && (
                  <>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      {t('items.stock.averageCost')}
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      {t('items.stock.value')}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stock.data.branches.map((row) => (
                <BranchRow
                  key={row.branchId}
                  row={row}
                  unit={item.stockUnit}
                  mine={row.branchId === context.branchId}
                  showCost={showCost}
                />
              ))}
            </tbody>
          </table>
        )}
        {elsewhere && context.canAdjustStock && (
          <p className="text-muted">{t('items.stock.elsewhere')}</p>
        )}
        {canChange && (
          <div className="flex flex-wrap gap-3">
            {mine.canOpen ? (
              <Button
                onClick={() => {
                  setDialog('opening');
                }}
              >
                {t('items.stock.open')}
              </Button>
            ) : (
              // Nothing has moved yet means nothing to remove; adding is what opening stock is for.
              <Button
                variant="secondary"
                onClick={() => {
                  setDialog('adjust');
                }}
              >
                {t('items.stock.adjust')}
              </Button>
            )}
          </div>
        )}
        {stock.data && <History item={item} context={context} />}
      </CardContent>
      {dialog === 'opening' && mine && (
        <OpeningDialog
          item={item}
          branch={mine}
          showCost={showCost}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog === 'adjust' && mine && (
        <AdjustDialog
          item={item}
          branch={mine}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
    </Card>
  );
}

function BranchRow({
  row,
  unit,
  mine,
  showCost,
}: {
  row: BranchStockView;
  unit: BuiltInUnit;
  mine: boolean;
  showCost: boolean;
}) {
  const { t } = useTranslation();
  const money = (paise: number | null | undefined) =>
    paise === null || paise === undefined ? '—' : formatPaise(paise);
  return (
    <tr>
      <th scope="row" className="py-2.5 pr-4 text-left font-medium">
        {row.branchName}
        {mine && (
          <Badge tone="info" className="ml-2">
            {t('items.stock.yourBranch')}
          </Badge>
        )}
      </th>
      <td className="py-2.5 pr-4 text-right">
        <span className="inline-flex items-center gap-2">
          <StockBadge quantity={row.quantity} low={row.low} />
          <span className="font-semibold">{stockText(t, row.quantity, unit)}</span>
        </span>
      </td>
      <td className="py-2.5 pr-4 text-right text-muted">
        {row.lowStockLevel === null
          ? t('items.stock.noLevel')
          : stockText(t, row.lowStockLevel, unit)}
      </td>
      {showCost && (
        <>
          <td className="py-2.5 pr-4 text-right text-muted">{money(row.averageCost)}</td>
          <td className="py-2.5 text-right">{money(row.value)}</td>
        </>
      )}
    </tr>
  );
}

/** The history at one branch, newest first (design §8: 50 at a time, keyset on the id). */
function History({ item, context }: { item: ItemView; context: ItemsContext }) {
  const { t, i18n } = useTranslation();
  const [branchId, setBranchId] = useState(context.branchId);
  const movements = useMovements(item.id, branchId);
  const rows = movements.data?.pages.flatMap((page) => page.movements) ?? [];
  const showCost = context.canViewCost;
  // A business date is a day, not an instant: shown as it is, never shifted by a time zone.
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const dateText = (date: string) => day.format(new Date(`${date}T00:00:00Z`));
  const what = (row: MovementView) =>
    row.kind === 'adjustment' && row.reason !== null
      ? t(`items.stock.reasons.${row.reason}`)
      : t(`items.stock.kinds.${row.kind}`);

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="font-medium">{t('items.stock.history')}</h3>
        {context.branches.length > 1 && (
          <div className="w-56">
            <Field label={t('items.stock.historyBranch')}>
              {(props) => (
                <Select
                  {...props}
                  value={branchId}
                  onChange={(event) => {
                    setBranchId(event.target.value);
                  }}
                >
                  {context.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
      </div>
      <table className="w-full text-left tabular-nums">
        <caption className="sr-only">{t('items.stock.history')}</caption>
        <thead className="border-b border-border text-label text-muted">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('items.stock.historyColumns.date')}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {t('items.stock.historyColumns.what')}
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              {t('items.stock.historyColumns.change')}
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              {t('items.stock.historyColumns.balance')}
            </th>
            {showCost && (
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {t('items.stock.historyColumns.value')}
              </th>
            )}
            <th scope="col" className="py-2 font-medium">
              {t('items.stock.historyColumns.who')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="align-top">
              <td className="py-2.5 pr-4 whitespace-nowrap text-muted">
                {dateText(row.businessDate)}
              </td>
              <td className="py-2.5 pr-4">
                {what(row)}
                {row.note !== null && <div className="text-label text-muted">{row.note}</div>}
              </td>
              <td
                className={`py-2.5 pr-4 text-right font-medium ${row.quantity < 0 ? 'text-danger' : 'text-success'}`}
              >
                {row.quantity > 0 ? '+' : ''}
                {stockText(t, row.quantity, item.stockUnit)}
              </td>
              <td className="py-2.5 pr-4 text-right">
                {stockText(t, row.balanceAfter, item.stockUnit)}
              </td>
              {showCost && (
                <td className="py-2.5 pr-4 text-right text-muted">
                  {row.value === null || row.value === undefined ? '—' : formatPaise(row.value)}
                </td>
              )}
              <td className="py-2.5">{row.actorName ?? t(`session.roles.${row.actorRole}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {movements.isPending && <p className="text-muted">{t('items.loading')}</p>}
      {movements.isError && (
        <div role="alert" className="flex items-center gap-3">
          <p>{t('items.stock.loadFailed')}</p>
          <Button variant="secondary" size="sm" onClick={() => void movements.refetch()}>
            {t('items.retry')}
          </Button>
        </div>
      )}
      {movements.isSuccess && rows.length === 0 && (
        <p className="text-muted">{t('items.stock.noHistory')}</p>
      )}
      {movements.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          disabled={movements.isFetchingNextPage}
          onClick={() => void movements.fetchNextPage()}
        >
          {t('items.stock.more')}
        </Button>
      )}
    </section>
  );
}

/** The error codes a stock change can answer that the dialog explains in words. */
const KNOWN_REFUSALS = new Set([
  'below_zero',
  'opening_exists',
  'cost_required',
  'archived',
  'service_has_no_stock',
  'busy',
  'key_reused',
  'forbidden',
]);

/** Answers that mean what the page shows is out of date: the item itself, or its stock. */
const REFRESH_ON = new Set(['opening_exists', 'key_reused', 'below_zero', 'archived']);

/**
 * Sends one stock change with the dialog's request key, then refreshes the card, the history
 * and the list. The key is made once per dialog, so every retry of this change carries it.
 */
function useStockChange<Form extends FieldValues>(
  item: ItemView,
  path: 'opening' | 'adjustments',
  /** The fields the dialog shows: an error on any other has nowhere to appear. */
  shown: readonly FieldPath<Form>[],
  setError: (field: FieldPath<Form>, code: string) => void,
  onDone: () => void,
) {
  const queryClient = useQueryClient();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: itemKeys.stock(item.id) }),
      queryClient.invalidateQueries({ queryKey: [...itemKeys.all, 'list'] }),
    ]);
  // A refusal can mean the item changed too (archived at another counter): read it again, so
  // the page shows Restore instead of offering changes that can't be made.
  const refreshAll = () =>
    Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: itemKeys.one(item.id) })]);

  const send = async (body: unknown) => {
    setRefusal(null);
    setSaving(true);
    try {
      await sendStockChange(() =>
        apiRequest('POST', `/api/items/${encodeURIComponent(item.id)}/stock/${path}`, body),
      );
      await refresh();
      onDone();
    } catch (error) {
      const onFields =
        error instanceof ApiError && error.code === 'invalid_body'
          ? Object.entries(error.fields).filter(([field]) =>
              shown.includes(field as FieldPath<Form>),
            )
          : [];
      if (onFields.length > 0) {
        for (const [field, code] of onFields) setError(field as FieldPath<Form>, code);
      } else {
        const code = error instanceof ApiError ? error.code : 'failed';
        setRefusal(KNOWN_REFUSALS.has(code) ? code : 'failed');
        if (REFRESH_ON.has(code)) void refreshAll();
      }
    } finally {
      setSaving(false);
    }
  };
  return { send, requestKey, refusal, saving };
}

/**
 * The browser's own modal `<dialog>` (ADR 0026), open while mounted; Esc or Cancel closes it.
 * The Stock card sits inside the item's form, so the dialog is put at the end of the page (no
 * form inside a form) and its submit stops here: React passes events up its own tree, portal or
 * not, and the item form would otherwise save too.
 */
function StockDialog({
  title,
  lead,
  onClose,
  children,
}: {
  title: string;
  lead: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const leadId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={leadId}
      onClose={onClose}
      onSubmit={(event) => {
        event.stopPropagation();
      }}
      className="m-auto w-full max-w-lg rounded-lg bg-surface p-6 text-foreground shadow-card"
    >
      <h2 id={titleId} className="text-section font-semibold">
        {title}
      </h2>
      <p id={leadId} className="mt-1 text-muted">
        {lead}
      </p>
      <div className="mt-5">{children}</div>
    </dialog>,
    document.body,
  );
}

function DialogFooter({
  refusal,
  saving,
  save,
  onClose,
}: {
  refusal: string | null;
  saving: boolean;
  save: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {refusal !== null && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
          {t(`items.stock.errors.${refusal}` as never)}
        </p>
      )}
      <div className="flex justify-end gap-3 pt-1">
        <Button variant="secondary" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? t('items.stock.saving') : save}
        </Button>
      </div>
    </>
  );
}

/** Opening stock (#9, owner answer 4A): once per item per branch, at the caller's branch. */
function OpeningDialog({
  item,
  branch,
  showCost,
  onClose,
}: {
  item: ItemView;
  branch: BranchStockView;
  showCost: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const unit = unitName(t, item.stockUnit);
  const form = useForm<OpeningForm>({
    defaultValues: {
      quantity: '',
      ...(showCost && { unitCost: rupeesText(item.purchasePrice) }),
    },
  });
  const errors = form.formState.errors;
  const change = useStockChange<OpeningForm>(
    item,
    'opening',
    showCost ? ['quantity', 'unitCost'] : ['quantity'],
    (field, code) => {
      form.setError(field, { message: code });
    },
    onClose,
  );
  const submit = form.handleSubmit((values) => {
    const checked = openingBody(values, item.stockUnit, change.requestKey);
    if ('errors' in checked) {
      setErrors(form.setError, checked.errors);
      return;
    }
    return change.send(checked.body);
  });

  return (
    <StockDialog
      title={t('items.stock.openingDialog.title', { name: item.name })}
      lead={t('items.stock.openingDialog.lead', { branch: branch.branchName })}
      onClose={onClose}
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field
            label={t('items.stock.openingDialog.quantity', { unit })}
            error={errorText('quantity', errors.quantity?.message)}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                autoComplete="off"
                className="tabular-nums"
                {...form.register('quantity')}
              />
            )}
          </Field>
          {showCost && (
            <Field
              label={t('items.stock.openingDialog.unitCost', { unit })}
              hint={t('items.stock.openingDialog.unitCostHint')}
              error={errorText('unitCost', errors.unitCost?.message)}
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular-nums"
                  {...form.register('unitCost')}
                />
              )}
            </Field>
          )}
        </div>
        <DialogFooter
          refusal={change.refusal}
          saving={change.saving}
          save={t('items.stock.openingDialog.save')}
          onClose={onClose}
        />
      </form>
    </StockDialog>
  );
}

/** An adjustment (#11): a reason from the list, never below zero (2A), at the caller's branch. */
function AdjustDialog({
  item,
  branch,
  onClose,
}: {
  item: ItemView;
  branch: BranchStockView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const unit = unitName(t, item.stockUnit);
  const form = useForm<AdjustForm>({
    defaultValues: { direction: 'remove', reason: '', quantity: '', note: '' },
  });
  const errors = form.formState.errors;
  const direction = useWatch({ control: form.control, name: 'direction' });
  const reasons = reasonsFor(direction);
  const change = useStockChange<AdjustForm>(
    item,
    'adjustments',
    ['direction', 'reason', 'quantity', 'note'],
    (field, code) => {
      form.setError(field, { message: code });
    },
    onClose,
  );

  // Adding has one reason; going back to removing asks again rather than keep it silently.
  useEffect(() => {
    form.setValue('reason', direction === 'add' ? 'count_mismatch' : '');
  }, [direction, form]);

  const submit = form.handleSubmit((values) => {
    const checked = adjustmentBody(values, item.stockUnit, change.requestKey);
    if ('errors' in checked) {
      setErrors(form.setError, checked.errors);
      return;
    }
    return change.send(checked.body);
  });

  return (
    <StockDialog
      title={t('items.stock.adjustDialog.title', { name: item.name })}
      lead={t('items.stock.adjustDialog.lead', {
        branch: branch.branchName,
        quantity: stockText(t, branch.quantity, item.stockUnit),
      })}
      onClose={onClose}
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <ChoiceCards
          label={t('items.stock.adjustDialog.direction')}
          choices={[
            {
              value: 'remove',
              title: t('items.stock.adjustDialog.remove'),
              hint: t('items.stock.adjustDialog.removeHint'),
            },
            {
              value: 'add',
              title: t('items.stock.adjustDialog.add'),
              hint: t('items.stock.adjustDialog.addHint'),
            },
          ]}
          inputProps={form.register('direction')}
        />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field
            label={t('items.stock.adjustDialog.reason')}
            error={errorText('reason', errors.reason?.message)}
          >
            {(props) => (
              <Select {...props} {...form.register('reason')}>
                {direction === 'remove' && (
                  <option value="">{t('items.stock.adjustDialog.choose')}</option>
                )}
                {reasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {t(`items.stock.reasons.${reason}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('items.stock.adjustDialog.quantity', { unit })}
            error={errorText('quantity', errors.quantity?.message)}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                autoComplete="off"
                className="tabular-nums"
                {...form.register('quantity')}
              />
            )}
          </Field>
          <div className="col-span-2">
            <Field
              label={t('items.stock.adjustDialog.note')}
              hint={t('items.stock.adjustDialog.noteHint')}
              error={errorText('note', errors.note?.message)}
            >
              {(props) => <Textarea {...props} rows={2} {...form.register('note')} />}
            </Field>
          </div>
        </div>
        <DialogFooter
          refusal={change.refusal}
          saving={change.saving}
          save={t('items.stock.adjustDialog.save')}
          onClose={onClose}
        />
      </form>
    </StockDialog>
  );
}

/** Puts each checked field's error code on the form, where `useFieldError` words it. */
function setErrors<Form extends FieldValues>(
  setError: UseFormSetError<Form>,
  errors: FieldErrors,
): void {
  for (const [field, code] of Object.entries(errors)) {
    setError(field as FieldPath<Form>, { message: code });
  }
}
