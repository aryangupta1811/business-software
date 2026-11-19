import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmEmail } from '../../api/account';
import { ApiError } from '../../api/client';
import { SESSION_KEY } from '../../api/session';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';

/**
 * Module 00 #32, #42: the page a confirmation email links to. Opening it changes nothing; the
 * button sends the token, so a mail scanner that opens links can't use it up.
 */
export const Route = createFileRoute('/_public/confirm-email/$businessId/$token')({
  component: ConfirmEmail,
});

type State = 'ready' | 'sending' | 'done' | 'invalid' | 'failed';

function ConfirmEmail() {
  const { t } = useTranslation();
  const { businessId, token } = Route.useParams();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>('ready');

  const confirm = async () => {
    setState('sending');
    try {
      await confirmEmail(businessId, token);
      setState('done');
      // The banner reads the session: it goes away on the next look.
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    } catch (error) {
      const invalid =
        error instanceof ApiError && ['invalid_link', 'invalid_body'].includes(error.code);
      setState(invalid ? 'invalid' : 'failed');
    }
  };

  return (
    <Card className="w-full max-w-md self-start">
      <CardContent className="flex flex-col gap-6 px-8 py-7">
        <h1 className="text-title font-semibold">{t('confirmPage.title')}</h1>
        {state === 'done' ? (
          <div role="status" className="flex flex-col gap-4">
            <p className="flex items-start gap-3 rounded-lg bg-success-soft px-4 py-3 text-success">
              <MailCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {t('confirmPage.done')}
            </p>
            <Link to="/" className="text-accent underline-offset-4 hover:underline">
              {t('confirmPage.toApp')}
            </Link>
          </div>
        ) : state === 'invalid' ? (
          <p role="alert">{t('confirmPage.invalid')}</p>
        ) : (
          <>
            <p className="text-muted">{t('confirmPage.lead')}</p>
            {state === 'failed' && (
              <p role="alert" className="text-danger">
                {t('confirmPage.failed')}
              </p>
            )}
            <Button disabled={state === 'sending'} onClick={() => void confirm()}>
              {t(state === 'sending' ? 'confirmPage.sending' : 'confirmPage.submit')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
