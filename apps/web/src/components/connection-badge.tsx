import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchReadiness, type Readiness } from '../api/health';

// Billing needs the server (ADR 0001), so the counter should always see whether it's there.
const CHECK_EVERY_MS = 30_000;

const STATES = {
  checking: { text: 'connection.checking', dot: 'bg-stone-400' },
  connected: { text: 'connection.connected', dot: 'bg-emerald-600' },
  'database-down': { text: 'connection.databaseDown', dot: 'bg-amber-500' },
  'server-down': { text: 'connection.serverDown', dot: 'bg-red-600' },
} as const satisfies Record<Readiness | 'checking', { text: string; dot: string }>;

export function ConnectionBadge() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => fetchReadiness(),
    refetchInterval: CHECK_EVERY_MS,
  });
  const state = STATES[data ?? 'checking'];

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-stone-700">
      <span aria-hidden="true" className={`size-2.5 rounded-full ${state.dot}`} />
      {t(state.text)}
    </p>
  );
}
