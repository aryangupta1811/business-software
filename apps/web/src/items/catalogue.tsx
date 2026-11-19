import { BUILT_IN_UNITS, type CategoryView, type UnitView } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiRequest } from '../api/client';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useFieldError } from '../lib/field-error';
import { itemKeys, useCategories, useUnits } from './api';
import { formatQuantity, parseQuantity } from './item-form';
import { unitName } from './labels';
import { QueryGate } from './query-gate';

/**
 * The owner's categories and own units (design §7: a tab on the Items page, not in Settings).
 * Nothing is deleted: archiving hides a name from new items and frees it (ADR 0007).
 */
export function Catalogue({ canManage }: { canManage: boolean }) {
  const categories = useCategories();
  const units = useUnits();
  return (
    <QueryGate queries={[categories, units]}>
      {() => (
        <div className="grid max-w-5xl grid-cols-2 items-start gap-6">
          <Categories rows={categories.data ?? []} canManage={canManage} />
          <Units rows={units.data ?? []} canManage={canManage} />
        </div>
      )}
    </QueryGate>
  );
}

/** Sends one change, then refreshes the list; a code the API answers comes back for a field. */
function useSend(key: readonly string[]) {
  const queryClient = useQueryClient();
  return async (method: string, path: string, body?: unknown): Promise<string | null> => {
    try {
      await apiRequest(method, path, body);
      await queryClient.invalidateQueries({ queryKey: key });
      // Item rows show category names and packs show unit names.
      await queryClient.invalidateQueries({ queryKey: itemKeys.all });
      return null;
    } catch (error) {
      if (error instanceof ApiError) {
        return Object.values(error.fields)[0] ?? error.code;
      }
      return 'server';
    }
  };
}

function Section({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="flex flex-col gap-1 px-6 pt-5">
        <CardTitle id={titleId}>{title}</CardTitle>
        <p className="text-muted">{lead}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-6 pb-5">{children}</CardContent>
    </Card>
  );
}

function ArchiveButton({
  archived,
  name,
  onClick,
}: {
  archived: boolean;
  name: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      {archived ? t('items.restore') : t('items.archive')}
      <span className="sr-only"> {name}</span>
    </Button>
  );
}

function Categories({ rows, canManage }: { rows: CategoryView[]; canManage: boolean }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const send = useSend(itemKeys.categories);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; error: string | null }>();

  const add = async (event: SyntheticEvent) => {
    event.preventDefault();
    const code = await send('POST', '/api/categories', { name });
    setError(code);
    if (code === null) setName('');
  };

  return (
    <Section title={t('items.catalogue.categories')} lead={t('items.catalogue.categoriesLead')}>
      {rows.length === 0 ? (
        <p className="text-muted">{t('items.catalogue.noCategories')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex min-h-11 items-center gap-2 py-1.5">
              {editing?.id === row.id ? (
                <form
                  className="flex flex-1 items-start gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send('PUT', `/api/categories/${row.id}`, { name: editing.name }).then(
                      (code) => {
                        setEditing(code === null ? undefined : { ...editing, error: code });
                      },
                    );
                  }}
                >
                  <div className="flex-1">
                    <Field
                      label={t('items.catalogue.categoryName')}
                      error={errorText('categoryName', editing.error ?? undefined)}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          value={editing.name}
                          onChange={(event) => {
                            setEditing({ ...editing, name: event.target.value });
                          }}
                        />
                      )}
                    </Field>
                  </div>
                  <Button type="submit" size="sm" className="mt-7">
                    {t('items.save')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-7"
                    onClick={() => {
                      setEditing(undefined);
                    }}
                  >
                    {t('dialog.cancel')}
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1">{row.name}</span>
                  {row.archived && <Badge tone="warning">{t('items.archived')}</Badge>}
                  {canManage && !row.archived && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing({ id: row.id, name: row.name, error: null });
                      }}
                    >
                      {t('items.catalogue.rename')}
                      <span className="sr-only"> {row.name}</span>
                    </Button>
                  )}
                  {canManage && (
                    <ArchiveButton
                      archived={row.archived}
                      name={row.name}
                      onClick={() => {
                        const action = row.archived ? 'restore' : 'archive';
                        void send('POST', `/api/categories/${row.id}/${action}`).then(setError);
                      }}
                    />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form noValidate onSubmit={(event) => void add(event)} className="flex items-start gap-3">
          <div className="flex-1">
            <Field
              label={t('items.catalogue.newCategory')}
              error={errorText('categoryName', error ?? undefined)}
            >
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
          <Button type="submit" className="mt-7">
            {t('items.catalogue.add')}
          </Button>
        </form>
      )}
    </Section>
  );
}

function Units({ rows, canManage }: { rows: UnitView[]; canManage: boolean }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const send = useSend(itemKeys.units);
  const blank = { name: '', hindiName: '', baseUnit: 'piece', size: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<{ field: string; code: string } | null>(null);
  const set = (field: keyof typeof blank) => (event: { target: { value: string } }) => {
    setForm({ ...form, [field]: event.target.value });
  };

  const add = async (event: SyntheticEvent) => {
    event.preventDefault();
    const defaultSize = parseQuantity(form.size);
    if (defaultSize === null || defaultSize === 0) {
      setError({ field: 'size', code: form.size.trim() === '' ? 'required' : 'invalid' });
      return;
    }
    const code = await send('POST', '/api/units', {
      name: form.name,
      hindiName: form.hindiName.trim() === '' ? null : form.hindiName,
      baseUnit: form.baseUnit,
      defaultSize,
    });
    setError(code === null ? null : { field: 'unitName', code });
    if (code === null) setForm(blank);
  };
  const errorFor = (field: string) =>
    error?.field === field ? errorText(field, error.code) : undefined;

  return (
    <Section title={t('items.catalogue.units')} lead={t('items.catalogue.unitsLead')}>
      {rows.length === 0 ? (
        <p className="text-muted">{t('items.catalogue.noUnits')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex min-h-11 items-center gap-2 py-1.5">
              <span className="flex-1">
                {row.name}
                {row.hindiName && <span className="ml-2 text-muted">{row.hindiName}</span>}
                <span className="block text-label text-muted">
                  {t('items.catalogue.unitSize', {
                    name: row.name,
                    size: formatQuantity(row.defaultSize),
                    base: unitName(t, row.baseUnit),
                  })}
                </span>
              </span>
              {row.archived && <Badge tone="warning">{t('items.archived')}</Badge>}
              {canManage && (
                <ArchiveButton
                  archived={row.archived}
                  name={row.name}
                  onClick={() => {
                    const action = row.archived ? 'restore' : 'archive';
                    void send('POST', `/api/units/${row.id}/${action}`).then((code) => {
                      setError(code === null ? null : { field: 'unitName', code });
                    });
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          noValidate
          onSubmit={(event) => void add(event)}
          className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4"
        >
          <Field label={t('items.catalogue.unitName')} error={errorFor('unitName')}>
            {(props) => <Input {...props} value={form.name} onChange={set('name')} />}
          </Field>
          <Field label={t('items.fields.hindiName')}>
            {(props) => (
              <Input {...props} lang="hi" value={form.hindiName} onChange={set('hindiName')} />
            )}
          </Field>
          <Field label={t('items.catalogue.baseUnit')}>
            {(props) => (
              <Select {...props} value={form.baseUnit} onChange={set('baseUnit')}>
                {BUILT_IN_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unitName(t, unit)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('items.catalogue.defaultSize')}
            hint={t('items.catalogue.defaultSizeHint')}
            error={errorFor('size')}
          >
            {(props) => (
              <Input {...props} inputMode="decimal" value={form.size} onChange={set('size')} />
            )}
          </Field>
          <Button type="submit" className="col-span-2 justify-self-start">
            {t('items.catalogue.addUnit')}
          </Button>
        </form>
      )}
    </Section>
  );
}
