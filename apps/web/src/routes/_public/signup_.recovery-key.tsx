import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Copy, KeyRound, Printer } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { forgetRecoveryKey, readRecoveryKey } from '../../signup/pending-key';

/** Module 00 #31: the key is shown once, from memory, right after signup. */
export const Route = createFileRoute('/_public/signup_/recovery-key')({ component: RecoveryKey });

function RecoveryKey() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirmId = useId();
  const [pending] = useState(readRecoveryKey);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  if (pending === null) return <KeyGone />;
  const groups = pending.recoveryKey.split('-');
  const made = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
    pending.createdAt,
  );

  return (
    <Card className="w-full max-w-2xl self-start print:shadow-none">
      <CardContent className="flex flex-col gap-6 px-8 py-7">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning print:hidden [&_svg]:size-6"
          >
            <KeyRound />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-title font-semibold">{t('recoveryKey.title')}</h1>
            <p className="hidden print:block">
              {t('recoveryKey.printedFor', { business: pending.businessName, date: made })}
            </p>
            <p className="text-muted print:hidden">{t('recoveryKey.body')}</p>
          </div>
        </div>

        <div
          aria-label={t('recoveryKey.label')}
          role="group"
          className="rounded-lg border border-border bg-surface-muted px-6 py-5 print:border-foreground print:bg-surface"
        >
          {/* Screen readers get the key in one piece, with its dashes. */}
          <span className="sr-only">{pending.recoveryKey}</span>
          <div
            aria-hidden="true"
            className="grid grid-cols-4 gap-x-6 gap-y-3 font-mono text-figure font-semibold tracking-widest"
          >
            {groups.map((group, index) => (
              <span key={index}>{group}</span>
            ))}
          </div>
        </div>

        <p className="text-muted print:hidden">{t('recoveryKey.keep')}</p>

        <div className="flex flex-wrap gap-3 print:hidden">
          <Button
            variant="secondary"
            onClick={() => {
              window.print();
            }}
          >
            <Printer aria-hidden="true" />
            {t('recoveryKey.print')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(pending.recoveryKey).then(() => {
                setCopied(true);
              });
            }}
          >
            <Copy aria-hidden="true" />
            {t(copied ? 'recoveryKey.copied' : 'recoveryKey.copy')}
          </Button>
        </div>

        <div className="flex flex-col gap-4 border-t border-border pt-5 print:hidden">
          <label htmlFor={confirmId} className="flex items-center gap-3">
            <input
              id={confirmId}
              type="checkbox"
              checked={saved}
              onChange={(event) => {
                setSaved(event.target.checked);
              }}
              className="size-5 accent-primary"
            />
            {t('recoveryKey.confirm')}
          </label>
          <Button
            disabled={!saved}
            className="self-start"
            onClick={() => {
              forgetRecoveryKey();
              // Login arrives in P1.4; until then, the app's home page.
              void navigate({ to: '/' });
            }}
          >
            {t('recoveryKey.continue')}
          </Button>
        </div>
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
