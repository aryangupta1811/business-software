import { createFileRoute } from '@tanstack/react-router';
import { useCategories, useItemsContext, useUnits } from '../../items/api';
import { ItemEditor } from '../../items/item-editor';
import { QueryGate } from '../../items/query-gate';

/** A new item; a scan of an unknown code arrives here with the code filled in (design §7). */
export const Route = createFileRoute('/_app/items/new')({
  component: NewItem,
  staticData: { titleKey: 'items.newTitle' },
  validateSearch: (search: Record<string, unknown>): { barcode?: string } =>
    typeof search.barcode === 'string' ? { barcode: search.barcode } : {},
});

function NewItem() {
  const { barcode } = Route.useSearch();
  const context = useItemsContext();
  const categories = useCategories();
  const units = useUnits();
  return (
    <QueryGate queries={[context, categories, units]}>
      {() =>
        context.data && (
          <ItemEditor
            context={context.data}
            categories={categories.data ?? []}
            units={units.data ?? []}
            barcode={barcode}
          />
        )
      }
    </QueryGate>
  );
}
