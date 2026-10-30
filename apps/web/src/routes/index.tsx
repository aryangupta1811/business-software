import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="mt-2 text-stone-600">Billing, stock and udhaar will appear here.</p>
    </>
  );
}
