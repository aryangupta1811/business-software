import { useQuery } from '@tanstack/react-query';
import { fetchReadiness, type Readiness } from '../api/health';

// Billing needs the server (ADR 0001), so the counter should always see whether it's there.
const CHECK_EVERY_MS = 30_000;

const STATES: Record<Readiness | 'checking', { text: string; dot: string }> = {
  checking: { text: 'Checking connection…', dot: 'bg-stone-400' },
  connected: { text: 'Connected', dot: 'bg-emerald-600' },
  'database-down': { text: "Server is up, but data can't be loaded", dot: 'bg-amber-500' },
  'server-down': { text: "Can't reach the server", dot: 'bg-red-600' },
};

export function ConnectionBadge() {
  const { data } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => fetchReadiness(),
    refetchInterval: CHECK_EVERY_MS,
  });
  const state = STATES[data ?? 'checking'];

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-stone-700">
      <span aria-hidden="true" className={`size-2.5 rounded-full ${state.dot}`} />
      {state.text}
    </p>
  );
}
