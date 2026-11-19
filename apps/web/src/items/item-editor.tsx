import {
  BUILT_IN_UNITS,
  formatPaise,
  GST_RATES,
  ITEM_KINDS,
  parseRupees,
  type CategoryView,
  type ItemsContext,
  type ItemView,
  type UnitView,
} from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldPath,
  type UseFormReturn,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ApiError, apiRequest } from '../api/client';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useFieldError } from '../lib/field-error';
import { itemKeys } from './api';
import {
  emptyItemForm,
  fixedPackSize,
  formPath,
  itemFormFrom,
  itemResolver,
  margin,
  priceWithTax,
  type ItemForm,
} from './item-form';
import { gstRateText, unitName } from './labels';

/** The field each 409 belongs under (design §7: conflicts are shown under their field). */
const CONFLICT_FIELDS: Partial<Record<string, FieldPath<ItemForm>>> = {
  name_taken: 'name',
  code_taken: 'code',
  duplicate_pack: 'packs',
};

/** A value from an error answer, as text (absent or odd ones are blank). */
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A field of the pack, new barcode or level at `index`, named the way React Hook Form types it. */
const pathAt = <List extends 'packs' | 'barcodes' | 'levels', Key extends string>(
  list: List,
  index: number,
  key: Key,
) => `${list}.${String(index)}.${key}` as `${List}.${number}.${Key}`;

type Banner =
  { kind: 'stale' | 'archived' | 'failed' } | { kind: 'barcode'; code: string; itemName: string };

/** One page, three cards (design §7): basics; price and tax; packs, barcodes and levels. */
export function ItemEditor({
  item,
  context,
  categories,
  units,
  barcode,
}: {
  item?: ItemView;
  context: ItemsContext;
  categories: CategoryView[];
  units: UnitView[];
  barcode?: string | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<ItemForm, unknown, Record<string, unknown>>({
    resolver: itemResolver(context, item?.version),
    defaultValues: item ? itemFormFrom(item, context) : emptyItemForm(context, barcode),
  });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [saved, setSaved] = useState(false);
  const readOnly = !context.canManage || item?.archived === true;

  const showSaved = (view: ItemView) => {
    queryClient.setQueryData(itemKeys.one(view.id), view);
    void queryClient.invalidateQueries({ queryKey: [...itemKeys.all, 'list'] });
  };

  const save = async (body: Record<string, unknown>) => {
    setBanner(null);
    setSaved(false);
    try {
      const view = item
        ? await apiRequest<ItemView>('PUT', `/api/items/${item.id}`, body)
        : await apiRequest<ItemView>('POST', '/api/items', body);
      showSaved(view);
      if (item) {
        form.reset(itemFormFrom(view, context));
        setSaved(true);
      } else {
        await navigate({ to: '/items/$id', params: { id: view.id } });
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setBanner({ kind: 'failed' });
        return;
      }
      const field = CONFLICT_FIELDS[error.code];
      if (error.code === 'invalid_body') {
        for (const [path, code] of Object.entries(error.fields)) {
          form.setError(formPath(path.split('.')) as FieldPath<ItemForm>, { message: code });
        }
      } else if (field !== undefined) {
        form.setError(field, { message: error.code });
      } else if (error.code === 'barcode_taken') {
        setBanner({
          kind: 'barcode',
          code: asText(error.detail.barcode),
          itemName: asText(error.detail.itemName),
        });
      } else if (error.code === 'stale' || error.code === 'archived') {
        setBanner({ kind: error.code });
      } else {
        setBanner({ kind: 'failed' });
      }
    }
  };

  const kind = useWatch({ control: form.control, name: 'kind' });

  return (
    <form
      noValidate
      className="flex max-w-4xl flex-col gap-6"
      onSubmit={(event) => void form.handleSubmit(save)(event)}
    >
      {item?.archived && (
        <p role="status" className="rounded-lg bg-warning-soft px-4 py-3 text-warning">
          {t('items.isArchived')}
        </p>
      )}
      <fieldset disabled={readOnly} className="contents">
        <BasicsCard form={form} categories={categories} />
        <PriceCard form={form} context={context} />
        {kind === 'goods' && <StockCard form={form} context={context} units={units} item={item} />}
      </fieldset>
      {item && <Barcodes item={item} context={context} readOnly={readOnly} onSaved={showSaved} />}

      {banner && <BannerText banner={banner} />}
      <div className="sticky bottom-0 flex items-center gap-4 border-t border-border bg-background py-4">
        {!readOnly && (
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t(form.formState.isSubmitting ? 'items.saving' : item ? 'items.save' : 'items.create')}
          </Button>
        )}
        {saved && !form.formState.isDirty && (
          <p role="status" className="text-label text-success">
            {t('items.saved')}
          </p>
        )}
        {item && context.canManage && (
          <ArchiveControl
            item={item}
            onDone={(view) => {
              showSaved(view);
              form.reset(itemFormFrom(view, context));
            }}
          />
        )}
      </div>
    </form>
  );
}

function BannerText({ banner }: { banner: Banner }) {
  const { t } = useTranslation();
  const text =
    banner.kind === 'barcode'
      ? t('items.errors.barcodeTakenBy', { code: banner.code, name: banner.itemName })
      : t(`items.errors.${banner.kind}`);
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
      {text}
    </p>
  );
}

function EditorCard({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="flex flex-col gap-1 px-7 pt-6">
        <CardTitle id={titleId}>{title}</CardTitle>
        <p className="text-muted">{lead}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 px-7 pb-6">{children}</CardContent>
    </Card>
  );
}

/** A text field registered on the form, with its error code in words. */
function TextField({
  form,
  name,
  label,
  hint,
  errorKey,
  ...input
}: {
  form: UseFormReturn<ItemForm, unknown, Record<string, unknown>>;
  name: FieldPath<ItemForm>;
  label: string;
  hint?: string | undefined;
  /** The field whose wording the error uses, when the path's last part isn't it. */
  errorKey?: string;
} & Omit<React.ComponentProps<'input'>, 'name' | 'form'>) {
  const errorText = useFieldError();
  const code = errorAt(form, name);
  return (
    <Field
      label={label}
      hint={hint}
      error={errorText(errorKey ?? name.split('.').at(-1) ?? name, code)}
    >
      {(props) => <Input {...props} {...input} {...form.register(name)} />}
    </Field>
  );
}

/** The error code at a dotted path (`packs.0.size`), if any. */
function errorAt(
  form: UseFormReturn<ItemForm, unknown, Record<string, unknown>>,
  name: string,
): string | undefined {
  return form.getFieldState(name as FieldPath<ItemForm>, form.formState).error?.message;
}

function BasicsCard({
  form,
  categories,
}: {
  form: UseFormReturn<ItemForm, unknown, Record<string, unknown>>;
  categories: CategoryView[];
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const chosen = useWatch({ control: form.control, name: 'categoryId' });
  // An archived category stays where it is but isn't offered for new choices.
  const offered = categories.filter((row) => !row.archived || row.id === chosen);
  return (
    <EditorCard title={t('items.cards.basics')} lead={t('items.cards.basicsLead')}>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        <Field label={t('items.fields.kind')} error={errorText('kind', errorAt(form, 'kind'))}>
          {(props) => (
            <Select {...props} {...form.register('kind')}>
              {ITEM_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`items.kinds.${kind}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <TextField form={form} name="name" label={t('items.fields.name')} autoComplete="off" />
        <TextField form={form} name="hindiName" label={t('items.fields.hindiName')} lang="hi" />
        <TextField
          form={form}
          name="code"
          label={t('items.fields.code')}
          hint={t('items.fields.codeHint')}
          className="font-mono"
        />
        <Field
          label={t('items.fields.category')}
          hint={t('items.fields.categoryHint')}
          error={errorText('categoryId', errorAt(form, 'categoryId'))}
        >
          {(props) => (
            <Select {...props} {...form.register('categoryId')}>
              <option value="">{t('items.noCategory')}</option>
              {offered.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <TextField form={form} name="brand" label={t('items.fields.brand')} />
      </div>
    </EditorCard>
  );
}

function PriceCard({
  form,
  context,
}: {
  form: UseFormReturn<ItemForm, unknown, Record<string, unknown>>;
  context: ItemsContext;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const values = useWatch({ control: form.control });
  const goods = values.kind === 'goods';
  const preview = priceWithTax({
    sellingPrice: values.sellingPrice ?? '',
    gstRate: values.gstRate ?? '',
    priceIncludesTax: values.priceIncludesTax ?? true,
  });
  const profit = context.canViewCost
    ? margin({ sellingPrice: values.sellingPrice ?? '', purchasePrice: values.purchasePrice ?? '' })
    : null;
  const selling = parseRupees(values.sellingPrice ?? '');
  const mrp = parseRupees(values.mrp ?? '');
  const aboveMrp = goods && selling !== null && mrp !== null && selling > mrp;
  const money = { inputMode: 'decimal' as const, className: 'tabular-nums' };
  const gstHint = context.needsGst ? undefined : t('items.fields.gstOptional');

  return (
    <EditorCard title={t('items.cards.price')} lead={t('items.cards.priceLead')}>
      <div className="grid grid-cols-3 gap-x-5 gap-y-4">
        <Field
          label={t('items.fields.stockUnit')}
          error={errorText('stockUnit', errorAt(form, 'stockUnit'))}
        >
          {(props) => (
            <Select {...props} {...form.register('stockUnit')}>
              {BUILT_IN_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unitName(t, unit)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <TextField
          form={form}
          name="sellingPrice"
          label={t('items.fields.sellingPrice')}
          {...money}
        />
        {goods && <TextField form={form} name="mrp" label={t('items.fields.mrp')} {...money} />}
        {context.features.includes('wholesale_price') && (
          <TextField
            form={form}
            name="wholesalePrice"
            label={t('items.fields.wholesalePrice')}
            {...money}
          />
        )}
        {context.canViewCost && (
          <TextField
            form={form}
            name="purchasePrice"
            label={t('items.fields.purchasePrice')}
            hint={t('items.fields.purchasePriceHint')}
            {...money}
          />
        )}
      </div>
      <div className="grid grid-cols-3 gap-x-5 gap-y-4">
        <Field
          label={t('items.fields.gstRate')}
          hint={gstHint}
          error={errorText('gstRate', errorAt(form, 'gstRate'))}
        >
          {(props) => (
            <Select {...props} {...form.register('gstRate')}>
              <option value="">{t('items.noGstRate')}</option>
              {GST_RATES.map((rate) => (
                <option key={rate} value={String(rate)}>
                  {gstRateText(rate)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <TextField
          form={form}
          name="hsn"
          label={goods ? t('items.fields.hsn') : t('items.fields.sac')}
          hint={gstHint}
          inputMode="numeric"
        />
        <div className="flex flex-col gap-1.5 pt-7">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              {...form.register('priceIncludesTax')}
            />
            {t('items.fields.priceIncludesTax')}
          </label>
          {errorAt(form, 'priceIncludesTax') && (
            <p className="text-label text-danger">
              {errorText('priceIncludesTax', errorAt(form, 'priceIncludesTax'))}
            </p>
          )}
        </div>
      </div>
      <dl
        aria-live="polite"
        className="grid grid-cols-3 gap-5 rounded-lg bg-surface-muted px-5 py-4 tabular-nums"
      >
        <Figure
          label={t('items.preview.taxable')}
          value={preview && formatPaise(preview.taxable)}
        />
        <Figure label={t('items.preview.tax')} value={preview && formatPaise(preview.tax)} />
        <Figure label={t('items.preview.total')} value={preview && formatPaise(preview.total)} />
        {profit && (
          <Figure
            label={t('items.preview.margin')}
            value={`${formatPaise(profit.amount)} (${String(profit.basisPoints / 100)}%)`}
          />
        )}
      </dl>
      {aboveMrp && (
        <p role="status" className="rounded-lg bg-warning-soft px-4 py-3 text-warning">
          {t('items.preview.aboveMrp')}
        </p>
      )}
    </EditorCard>
  );
}

function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-label text-muted">{label}</dt>
      <dd className="font-semibold">{value ?? '—'}</dd>
    </div>
  );
}

function StockCard({
  form,
  context,
  units,
  item,
}: {
  form: UseFormReturn<ItemForm, unknown, Record<string, unknown>>;
  context: ItemsContext;
  units: UnitView[];
  item: ItemView | undefined;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const packs = useFieldArray({ control: form.control, name: 'packs' });
  const newCodes = useFieldArray({ control: form.control, name: 'barcodes' });
  const stockUnit = useWatch({ control: form.control, name: 'stockUnit' });
  const packUnits = useWatch({ control: form.control, name: 'packs' });
  const showPacks = context.features.includes('multiple_units') || packs.fields.length > 0;

  // A pack in a unit with a fixed size (a dozen is 12 piece) gets that size filled in.
  useEffect(() => {
    packUnits.forEach((pack, index) => {
      const fixed = fixedPackSize(pack.unit, stockUnit);
      if (fixed !== null && pack.size !== fixed) {
        form.setValue(pathAt('packs', index, 'size'), fixed, { shouldDirty: true });
      }
    });
  }, [packUnits, stockUnit, form]);

  const unitChoices = [
    ...BUILT_IN_UNITS.filter((unit) => unit !== stockUnit).map((unit) => ({
      value: `b:${unit}`,
      label: unitName(t, unit),
    })),
    ...units
      .filter((unit) => !unit.archived || packUnits.some((pack) => pack.unit === `u:${unit.id}`))
      .map((unit) => ({ value: `u:${unit.id}`, label: unit.name })),
  ];

  return (
    <EditorCard title={t('items.cards.stock')} lead={t('items.cards.stockLead')}>
      {showPacks && (
        <section aria-label={t('items.packs.title')} className="flex flex-col gap-3">
          <h3 className="font-medium">{t('items.packs.title')}</h3>
          {errorAt(form, 'packs') && (
            <p className="text-label text-danger">{errorText('packs', errorAt(form, 'packs'))}</p>
          )}
          {packs.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-[1.2fr_1fr_1fr_1fr_auto] items-start gap-3 rounded-lg border border-border p-3"
            >
              <Field
                label={t('items.packs.unit')}
                error={errorText('unit', errorAt(form, pathAt('packs', index, 'unit')))}
              >
                {(props) => (
                  <Select {...props} {...form.register(pathAt('packs', index, 'unit'))}>
                    <option value="">{t('items.packs.chooseUnit')}</option>
                    {unitChoices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <TextField
                form={form}
                name={pathAt('packs', index, 'size')}
                label={t('items.packs.size', { unit: unitName(t, stockUnit as never) })}
                inputMode="decimal"
                readOnly={fixedPackSize(packUnits[index]?.unit ?? '', stockUnit) !== null}
              />
              <TextField
                form={form}
                name={pathAt('packs', index, 'sellingPrice')}
                label={t('items.packs.price')}
                hint={t('items.packs.priceHint')}
                inputMode="decimal"
              />
              <TextField
                form={form}
                name={pathAt('packs', index, 'mrp')}
                label={t('items.fields.mrp')}
                inputMode="decimal"
              />
              <Button
                variant="ghost"
                size="icon"
                className="mt-6"
                aria-label={t('items.packs.remove', { number: index + 1 })}
                onClick={() => {
                  packs.remove(index);
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
              <div className="col-span-5 flex gap-6 text-label">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    {...form.register(pathAt('packs', index, 'soldAsPack'))}
                  />
                  {t('items.packs.sold')}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    {...form.register(pathAt('packs', index, 'boughtAsPack'))}
                  />
                  {t('items.packs.bought')}
                </label>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              packs.append({
                id: null,
                unit: '',
                size: '',
                sellingPrice: '',
                mrp: '',
                soldAsPack: true,
                boughtAsPack: true,
              });
            }}
          >
            <Plus aria-hidden="true" />
            {t('items.packs.add')}
          </Button>
        </section>
      )}

      {!item && (
        <section aria-label={t('items.barcodes.title')} className="flex flex-col gap-3">
          <h3 className="font-medium">{t('items.barcodes.title')}</h3>
          <p className="text-label text-muted">{t('items.barcodes.newHint')}</p>
          {newCodes.fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-3">
              <div className="flex-1">
                <TextField
                  form={form}
                  name={pathAt('barcodes', index, 'code')}
                  label={t('items.barcodes.code', { number: index + 1 })}
                  errorKey="barcode"
                  className="font-mono"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="mt-6"
                aria-label={t('items.barcodes.remove', { code: field.code })}
                onClick={() => {
                  newCodes.remove(index);
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              newCodes.append({ code: '' });
            }}
          >
            <Plus aria-hidden="true" />
            {t('items.barcodes.add')}
          </Button>
        </section>
      )}

      {context.branches.length > 0 && (
        <section aria-label={t('items.levels.title')} className="flex flex-col gap-3">
          <h3 className="font-medium">{t('items.levels.title')}</h3>
          <div className="grid grid-cols-3 gap-x-5 gap-y-4">
            {context.branches.map((branch, index) => (
              <TextField
                key={branch.id}
                form={form}
                name={pathAt('levels', index, 'level')}
                label={t('items.levels.for', { branch: branch.name })}
                hint={t('items.levels.hint', { unit: unitName(t, stockUnit as never) })}
                inputMode="decimal"
              />
            ))}
          </div>
        </section>
      )}
    </EditorCard>
  );
}

/**
 * A saved item's barcodes: each is added or removed at once (not with Save), so a code
 * scanned at the counter works straight away. "Make an in-store code" asks the server for
 * the next one, which can't give two counters the same (#8).
 */
function Barcodes({
  item,
  context,
  readOnly,
  onSaved,
}: {
  item: ItemView;
  context: ItemsContext;
  readOnly: boolean;
  onSaved: (view: ItemView) => void;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const [code, setCode] = useState('');
  const [error, setError] = useState<{ code: string; detail?: string } | null>(null);
  const send = async (method: string, path: string, body?: unknown) => {
    setError(null);
    try {
      onSaved(await apiRequest<ItemView>(method, path, body));
      return true;
    } catch (failure) {
      if (failure instanceof ApiError) {
        setError({
          code: Object.values(failure.fields)[0] ?? failure.code,
          ...(failure.code === 'barcode_taken' && {
            detail: asText(failure.detail.itemName),
          }),
        });
      } else {
        setError({ code: 'server' });
      }
      return false;
    }
  };
  const packName = (packId: string | null) => {
    const pack = item.packs.find((row) => row.id === packId);
    if (!pack) return t('items.barcodes.stockUnit', { unit: unitName(t, item.stockUnit) });
    return pack.unitCode ? unitName(t, pack.unitCode) : (pack.unitName ?? '');
  };
  const message =
    error?.detail !== undefined
      ? t('items.errors.barcodeTakenBy', { code, name: error.detail })
      : errorText('barcode', error?.code);

  return (
    <EditorCard title={t('items.barcodes.title')} lead={t('items.barcodes.lead')}>
      {item.barcodes.length === 0 ? (
        <p className="text-muted">{t('items.barcodes.none')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {item.barcodes.map((row) => (
            <li key={row.id} className="flex min-h-11 items-center gap-3 py-1.5">
              <span className="font-mono">{row.code}</span>
              <span className="text-label text-muted">{packName(row.packId)}</span>
              {row.inStore && <Badge tone="info">{t('items.barcodes.inStore')}</Badge>}
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() =>
                    void send('POST', `/api/items/${item.id}/barcodes/${row.id}/remove`)
                  }
                >
                  {t('items.barcodes.removeSaved')}
                  <span className="sr-only"> {row.code}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && context.canManage && (
        <div className="flex flex-wrap items-start gap-3 border-t border-border pt-4">
          <div className="min-w-64 flex-1">
            <Field label={t('items.barcodes.newCode')} error={message}>
              {(props) => (
                <Input
                  {...props}
                  className="font-mono"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    // A scanner ends with Enter: add the code instead of saving the whole form.
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void send('POST', `/api/items/${item.id}/barcodes`, {
                      code,
                      packId: null,
                    }).then((ok) => {
                      if (ok) setCode('');
                    });
                  }}
                />
              )}
            </Field>
          </div>
          <Button
            variant="secondary"
            className="mt-7"
            onClick={() =>
              void send('POST', `/api/items/${item.id}/barcodes`, { code, packId: null }).then(
                (ok) => {
                  if (ok) setCode('');
                },
              )
            }
          >
            {t('items.barcodes.add')}
          </Button>
          <Button
            variant="secondary"
            className="mt-7"
            onClick={() =>
              void send('POST', `/api/items/${item.id}/barcodes`, { code: null, packId: null })
            }
          >
            {t('items.barcodes.makeInStore')}
          </Button>
        </div>
      )}
    </EditorCard>
  );
}

function ArchiveControl({ item, onDone }: { item: ItemView; onDone: (view: ItemView) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const action = item.archived ? 'restore' : 'archive';
  return (
    <>
      <Button
        variant={item.archived ? 'secondary' : 'ghost'}
        className="ml-auto"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t(`items.${action}`)}
      </Button>
      {failed && (
        <p role="alert" className="text-label text-danger">
          {t(
            `items.errors.${failed === 'name_taken' || failed === 'code_taken' ? failed : 'failed'}`,
          )}
        </p>
      )}
      <ConfirmDialog
        open={open}
        title={t(`items.confirm.${action}Title`, { name: item.name })}
        body={t(`items.confirm.${action}Body`)}
        confirm={t(`items.${action}`)}
        onClose={() => {
          setOpen(false);
        }}
        onConfirm={() => {
          setFailed(null);
          apiRequest<ItemView>('POST', `/api/items/${item.id}/${action}`).then(
            onDone,
            (error: unknown) => {
              setFailed(error instanceof ApiError ? error.code : 'failed');
            },
          );
        }}
      />
    </>
  );
}
