import { createFileRoute } from '@tanstack/react-router';
import { CustomerPage } from '../../udhaar/customer-page';

/** One customer's balance, unpaid bills and ledger, with Record payment (P1.18 design §7). */
export const Route = createFileRoute('/_app/customers/$id')({
  component: Customer,
  staticData: { titleKey: 'udhaar.page.title', permission: 'customers.view' },
});

function Customer() {
  const { id } = Route.useParams();
  // Another customer gets a fresh page: no payment notice or open dialog carries over.
  return <CustomerPage key={id} id={id} />;
}
