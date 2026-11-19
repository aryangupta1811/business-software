import { createFileRoute } from '@tanstack/react-router';
import { useCategories, useItemsContext, useUnits } from '../../items/api';
import { ItemEditor } from '../../items/item-editor';
import { QueryGate } from '../../items/query-gate';

/** A new item; a scan of an unknown code arrives here with the code filled in (design §7). */
export const Route = createFileRoute('/_app/items/new')({
  component: NewItem,
  staticData: { titleKey: 'items.newTitle' },
  // The router reads search values as JSON, so a typed `?barcode=8901234567890` arrives as a
  // number; a barcode is text.
  validateSearch: (search: Record<string, unknown>): { barcode?: string } =>
    typeof search.barcode === 'string' || typeof search.barcode === 'number'
      ? { barcode: String(search.barcode) }
      : {},
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
