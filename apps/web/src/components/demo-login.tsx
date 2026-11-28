import type { ActiveSession } from '@business-software/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { loginDemo, useDemoStatus } from '../api/demo';
import { useRetryTime } from '../lib/retry-time';
import { Button } from './ui/button';

/**
 * The demo's one-click login, above the ordinary form and only on the public demo server
 * (ADR 0016's 2026-11-24 note): a recruiter gets in as the owner or as a cashier, so permissions
 * show without a sign-up.
 */
export function DemoLogin({ onLoggedIn }: { onLoggedIn: (view: ActiveSession) => Promise<void> }) {
  const { t } = useTranslation();
  const retryTime = useRetryTime();
  const status = useDemoStatus();
  const [busy, setBusy] = useState<'owner' | 'cashier' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  if (status.data?.enabled !== true) return null;

  const start = async (as: 'owner' | 'cashier') => {
    setBusy(as);
    setFailure(null);
    try {
      await onLoggedIn(await loginDemo(as));
    } catch (error) {
      setBusy(null);
      setFailure(
        error instanceof ApiError && error.code === 'too_many_attempts'
          ? t('login.tooMany', { time: retryTime(error) })
          : t('demo.unavailable'),
      );
    }
  };

  return (
    <section
      aria-label={t('demo.label')}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-muted p-4"
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="font-semibold">{t('demo.title')}</h2>
        <p className="text-muted">{t('demo.lead')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void start('owner');
          }}
        >
          {t(busy === 'owner' ? 'demo.opening' : 'demo.owner')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => {
            void start('cashier');
          }}
        >
          {t(busy === 'cashier' ? 'demo.opening' : 'demo.cashier')}
        </Button>
      </div>
      {failure !== null && (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
    </section>
  );
}
