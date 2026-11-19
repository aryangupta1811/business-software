import type { ActiveSession } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { MailWarning } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sendConfirmation } from '../api/account';
import { ApiError } from '../api/client';
import { SESSION_KEY } from '../api/session';
import { useRetryTime } from '../lib/retry-time';
import { Button } from './ui/button';

/**
 * Module 00 #32, #45: until the owner confirms their email, a banner says so, with "Send
 * again". In the demo, email reaches only verified addresses, so it also points to the
 * recovery key.
 */
export function EmailBanner({ session }: { session: ActiveSession }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const retryTime = useRetryTime();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [failure, setFailure] = useState<string | null>(null);

  if (session.user.role !== 'owner' || session.emailConfirmed) return null;

  const sendAgain = async () => {
    setState('sending');
    setFailure(null);
    try {
      await sendConfirmation();
      setState('sent');
    } catch (error) {
      setState('idle');
      if (error instanceof ApiError && error.code === 'already_confirmed') {
        void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      } else if (error instanceof ApiError && error.code === 'too_many_attempts') {
        setFailure(t('emailBanner.tooMany', { time: retryTime(error) }));
      } else {
        setFailure(t('emailBanner.failed'));
      }
    }
  };

  return (
    <section
      aria-label={t('emailBanner.label')}
      className="flex items-start gap-3 border-b border-border bg-warning-soft px-8 py-3 print:hidden"
    >
      <MailWarning aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="flex flex-1 flex-col gap-1">
        <p>{t('emailBanner.body')}</p>
        {session.emailLimited && <p className="text-muted">{t('emailBanner.limited')}</p>}
        {state === 'sent' && (
          <p role="status" className="text-label text-success">
            {t('emailBanner.sent')}
          </p>
        )}
        {failure !== null && (
          <p role="alert" className="text-label text-danger">
            {failure}
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        disabled={state === 'sending'}
        onClick={() => void sendAgain()}
        className="shrink-0"
      >
        {t(state === 'sending' ? 'emailBanner.sending' : 'emailBanner.sendAgain')}
      </Button>
    </section>
  );
}
