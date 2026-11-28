import { createFileRoute } from '@tanstack/react-router';
import { CustomersPage } from '../../udhaar/customers-page';

/** Module 03: who owes what, and the way into each customer's udhaar (P1.18 design §7). */
export const Route = createFileRoute('/_app/customers/')({
  component: CustomersPage,
  staticData: { titleKey: 'nav.customers', permission: 'customers.view' },
});
