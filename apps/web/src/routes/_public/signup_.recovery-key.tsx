import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RecoveryKeyPanel } from '../../components/recovery-key-panel';
import { useMadeOn } from '../../lib/made-on';
import { Card, CardContent } from '../../components/ui/card';
import { forgetRecoveryKey, readRecoveryKey } from '../../signup/pending-key';

/** Module 00 #31: the key is shown once, from memory, right after signup. */
export const Route = createFileRoute('/_public/signup_/recovery-key')({ component: RecoveryKey });

function RecoveryKey() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const madeOn = useMadeOn();
  const [pending] = useState(readRecoveryKey);

  if (pending === null) return <KeyGone />;
  return (
    <Card className="w-full max-w-2xl self-start print:shadow-none">
      <CardContent className="px-8 py-7">
        <RecoveryKeyPanel
          recoveryKey={pending.recoveryKey}
          printedLine={t('recoveryKey.printedFor', {
            business: pending.businessName,
            date: madeOn(pending.createdAt),
          })}
          doneLabel={t('recoveryKey.continue')}
          onDone={() => {
            forgetRecoveryKey();
            // Signup logged the owner in (#37).
            void navigate({ to: '/' });
          }}
        />
      </CardContent>
    </Card>
  );
}

/** After a reload, or a visit straight to this address: nothing to show, by design. */
function KeyGone() {
  const { t } = useTranslation();
  return (
    <Card className="w-full max-w-xl self-start">
      <CardContent className="flex flex-col gap-3 px-8 py-7">
        <h1 className="text-title font-semibold">{t('recoveryKey.gone.title')}</h1>
        <p className="text-muted">{t('recoveryKey.gone.body')}</p>
        <Link to="/" className="text-accent underline-offset-4 hover:underline">
          {t('recoveryKey.gone.home')}
        </Link>
      </CardContent>
    </Card>
  );
}
