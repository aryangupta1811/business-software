import { createFileRoute } from '@tanstack/react-router';
import { useCategories, useItem, useItemsContext, useUnits } from '../../items/api';
import { ItemEditor } from '../../items/item-editor';
import { QueryGate } from '../../items/query-gate';

/** One item: its basics, price and tax, packs, barcodes and levels (design §7). */
export const Route = createFileRoute('/_app/items/$id')({
  component: EditItem,
  staticData: { titleKey: 'items.editTitle', permission: 'items.view' },
});

function EditItem() {
  const { id } = Route.useParams();
  const context = useItemsContext();
  const categories = useCategories();
  const units = useUnits();
  const item = useItem(id);
  return (
    <QueryGate queries={[context, categories, units, item]}>
      {() =>
        context.data &&
        item.data && (
          // Another item gets a fresh form; after a save the form resets from the answer.
          <ItemEditor
            key={item.data.id}
            item={item.data}
            context={context.data}
            categories={categories.data ?? []}
            units={units.data ?? []}
          />
        )
      }
    </QueryGate>
  );
}
