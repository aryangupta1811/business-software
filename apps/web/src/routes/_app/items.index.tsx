import { formatPaise, type BarcodeMatch, type ItemPage } from '@business-software/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiRequest } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Kbd, KbdGroup } from '../../components/ui/kbd';
import { Select } from '../../components/ui/select';
import { itemKeys, useCategories, useItemsContext } from '../../items/api';
import { Catalogue } from '../../items/catalogue';
import { gstRateText, unitName } from '../../items/labels';
import { QueryGate } from '../../items/query-gate';
import { useScanner } from '../../items/scan';
import { keyLabels } from '../../shortcuts/keys';
import { useShortcut } from '../../shortcuts/use-shortcut';

type Tab = 'items' | 'catalogue';

/** Module 01 #1–3, #8: the items list, and the owner's categories and units (design §7). */
export const Route = createFileRoute('/_app/items/')({
  component: Items,
  staticData: { titleKey: 'nav.items' },
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    search.tab === 'catalogue' ? { tab: 'catalogue' } : {},
});

const NEW_ITEM_KEYS = 'Alt+N';
const SEARCH_DELAY_MS = 250;

function Items() {
  const { t } = useTranslation();
  const { tab = 'items' } = Route.useSearch();
  const context = useItemsContext();
  const categories = useCategories();
  const tabs: Tab[] = ['items', 'catalogue'];

  return (
    <QueryGate queries={[context, categories]}>
      {() => (
        <div className="flex flex-col gap-5">
          <div role="tablist" aria-label={t('items.tabs.label')} className="flex gap-1">
            {tabs.map((name) => (
              <Link
                key={name}
                to="/items"
                search={name === 'items' ? {} : { tab: name }}
                role="tab"
                aria-selected={tab === name}
                className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-muted aria-selected:bg-surface-muted aria-selected:font-semibold aria-selected:text-foreground"
              >
                {t(`items.tabs.${name}`)}
              </Link>
            ))}
          </div>
          {tab === 'items' ? (
            <ItemList />
          ) : (
            <Catalogue canManage={context.data?.canManage ?? false} />
          )}
        </div>
      )}
    </QueryGate>
  );
}

function ItemList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const context = useItemsContext().data;
  const categories = useCategories().data ?? [];
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Ask the server once typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(typed.trim());
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);

  const filters = { q, category, archived };
  const list = useInfiniteQuery({
    queryKey: itemKeys.list(filters),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      if (archived) params.set('archived', 'true');
      if (pageParam) params.set('after', pageParam);
      const query = params.toString();
      return apiRequest<ItemPage>('GET', `/api/items${query ? `?${query}` : ''}`);
    },
    initialPageParam: '',
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  useShortcut({
    keys: '/',
    description: 'shortcuts.search',
    group: 'general',
    action: () => searchRef.current?.focus(),
  });
  useShortcut({
    keys: NEW_ITEM_KEYS,
    description: 'shortcuts.newItem',
    group: 'general',
    action: () => {
      if (context?.canManage) void navigate({ to: '/items/new' });
    },
  });

  // A scan with no field focused opens the item, or a new one with the code filled in.
  useScanner((code) => {
    setScanError(null);
    apiRequest<BarcodeMatch>('GET', `/api/items/barcode/${encodeURIComponent(code)}`).then(
      (match) => void navigate({ to: '/items/$id', params: { id: match.item.id } }),
      (error: unknown) => {
        if (error instanceof ApiError && error.code === 'unknown_barcode' && context?.canManage) {
          void navigate({ to: '/items/new', search: { barcode: code } });
        } else {
          setScanError(code);
        }
      },
    );
  });

  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const categoryName = (id: string | null) => categories.find((row) => row.id === id)?.name ?? '';
  const showCost = context?.canViewCost ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-72 flex-1">
          <label htmlFor={searchId} className="sr-only">
            {t('items.search')}
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-3 left-3 size-4 text-muted"
          />
          <Input
            ref={searchRef}
            id={searchId}
            type="search"
            aria-keyshortcuts="/"
            placeholder={t('items.searchPlaceholder')}
            className="pl-9"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </div>
        <Select
          aria-label={t('items.category')}
          className="w-48"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
          }}
        >
          <option value="">{t('items.allCategories')}</option>
          {categories
            .filter((row) => !row.archived)
            .map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
        </Select>
        <label className="flex h-10 items-center gap-2 text-muted">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
            }}
          />
          {t('items.showArchived')}
        </label>
        {context?.canManage && (
          <Button
            aria-keyshortcuts={NEW_ITEM_KEYS}
            onClick={() => void navigate({ to: '/items/new' })}
          >
            <Plus aria-hidden="true" />
            {t('items.add')}
            <KbdGroup aria-hidden="true" className="opacity-80">
              {keyLabels(NEW_ITEM_KEYS).map((label) => (
                <Kbd key={label}>{label}</Kbd>
              ))}
            </KbdGroup>
          </Button>
        )}
      </div>

      {scanError !== null && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
          {t('items.scanUnknown', { code: scanError })}
        </p>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-left">
          <caption className="sr-only">{t('nav.items')}</caption>
          <thead className="border-b border-border text-label text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('items.columns.name')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('items.columns.code')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('items.columns.category')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('items.columns.unit')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('items.columns.price')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('items.columns.mrp')}
              </th>
              {showCost && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('items.columns.cost')}
                </th>
              )}
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('items.columns.gst')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-muted">
                <td className="px-4 py-2.5">
                  <Link
                    to="/items/$id"
                    params={{ id: row.id }}
                    className="font-medium text-foreground hover:underline"
                  >
                    {row.name}
                  </Link>
                  {row.archived && (
                    <Badge tone="warning" className="ml-2">
                      {t('items.archived')}
                    </Badge>
                  )}
                  {row.hindiName && <div className="text-label text-muted">{row.hindiName}</div>}
                </td>
                <td className="px-4 py-2.5 font-mono text-label">{row.code}</td>
                <td className="px-4 py-2.5 text-muted">{categoryName(row.categoryId)}</td>
                <td className="px-4 py-2.5 text-muted">
                  {row.kind === 'service' ? t('items.service') : unitName(t, row.stockUnit)}
                </td>
                <td className="px-4 py-2.5 text-right">{formatPaise(row.sellingPrice)}</td>
                <td className="px-4 py-2.5 text-right text-muted">
                  {row.mrp === null ? '' : formatPaise(row.mrp)}
                </td>
                {showCost && (
                  <td className="px-4 py-2.5 text-right text-muted">
                    {row.purchasePrice == null ? '' : formatPaise(row.purchasePrice)}
                  </td>
                )}
                <td className="px-4 py-2.5 text-right text-muted">{gstRateText(row.gstRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.isPending && <p className="px-4 py-6 text-muted">{t('items.loading')}</p>}
        {list.isError && (
          <div role="alert" className="flex items-center gap-3 px-4 py-4">
            <p>{t('items.loadFailed')}</p>
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              {t('items.retry')}
            </Button>
          </div>
        )}
        {list.isSuccess && rows.length === 0 && (
          <p className="px-4 py-10 text-center text-muted">
            {q || category || archived ? t('items.noMatches') : t('items.empty')}
          </p>
        )}
      </Card>
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('items.more')}
        </Button>
      )}
    </div>
  );
}
