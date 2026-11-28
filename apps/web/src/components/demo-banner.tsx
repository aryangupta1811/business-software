import { DEMO_PASSWORD, type ActiveSession } from '@business-software/shared';
import { FlaskConical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onDemoRefused } from '../api/client';

/**
 * ADR 0016's 2026-11-24 note: in the public demo shop a banner says it is public, that it
 * resets, that real data doesn't belong in it, and what its password is (the lock screen and
 * the owner's-OK boxes ask for one). A refused action (`403 demo_refused`) explains itself here
 * too, whichever screen asked, so no form has to know about the demo.
 */
export function DemoBanner({ session }: { session: ActiveSession }) {
  const { t } = useTranslation();
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onDemoRefused(() => {
      setRefused(true);
      clearTimeout(timer);
      timer = setTimeout(() => {
        setRefused(false);
      }, 8_000);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);

  if (session.demo !== true) return null;
  return (
    <section
      aria-label={t('demo.label')}
      className="flex items-start gap-3 border-b border-border bg-warning-soft px-8 py-3 print:hidden"
    >
      <FlaskConical aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="flex flex-col gap-1">
        <p>
          <strong className="font-semibold">{t('demo.bannerTitle')}</strong> {t('demo.banner')}
        </p>
        <p className="text-muted">
          {t('demo.passwords')} <code className="font-mono text-foreground">{DEMO_PASSWORD}</code>
        </p>
        {refused && (
          <p role="alert" className="text-label font-medium text-danger">
            {t('demo.refused')}
          </p>
        )}
      </div>
    </section>
  );
}
