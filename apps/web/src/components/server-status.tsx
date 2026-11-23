import { LoaderCircle, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

function Centered({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 px-8 py-7 text-center">
          <span
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-accent [&_svg]:size-6"
          >
            {icon}
          </span>
          {children}
        </CardContent>
      </Card>
    </main>
  );
}

/** Shown while the session is being read, so a slow server never leaves a blank page. */
export function Connecting() {
  const { t } = useTranslation();
  return (
    <Centered icon={<LoaderCircle className="motion-safe:animate-spin" />}>
      <p role="status" className="text-title font-semibold">
        {t('server.connecting')}
      </p>
    </Centered>
  );
}

/** Shown when the session couldn't be read because the server didn't answer. */
export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Centered icon={<WifiOff />}>
      <div role="alert" className="flex flex-col gap-1">
        <p className="text-title font-semibold">{t('server.title')}</p>
        <p className="text-muted">{t('server.body')}</p>
      </div>
      <Button onClick={onRetry}>{t('server.retry')}</Button>
    </Centered>
  );
}
