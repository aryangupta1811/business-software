import { Copy, KeyRound, Printer } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

/**
 * Module 00 #31: a recovery key shown once, with Print and Copy, and a box to tick before
 * moving on. After signup, after a reset by recovery key, and from Settings' "Make a new key".
 * The key lives only in the page's memory; it is never stored or put in the address.
 */
export function RecoveryKeyPanel({
  recoveryKey,
  printedLine,
  doneLabel,
  onDone,
  heading: Heading = 'h1',
}: {
  recoveryKey: string;
  /** The line printed above the key: whose key and when it was made. */
  printedLine: string;
  doneLabel: string;
  onDone: () => void;
  /** h3 inside a Settings card, whose own title is the h2. */
  heading?: 'h1' | 'h3';
}) {
  const { t } = useTranslation();
  const confirmId = useId();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const groups = recoveryKey.split('-');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning print:hidden [&_svg]:size-6"
        >
          <KeyRound />
        </span>
        <div className="flex flex-col gap-1">
          <Heading className="text-title font-semibold">{t('recoveryKey.title')}</Heading>
          <p className="hidden print:block">{printedLine}</p>
          <p className="text-muted print:hidden">{t('recoveryKey.body')}</p>
        </div>
      </div>

      <div
        aria-label={t('recoveryKey.label')}
        role="group"
        className="rounded-lg border border-border bg-surface-muted px-6 py-5 print:border-foreground print:bg-surface"
      >
        {/* Screen readers get the key in one piece, with its dashes. */}
        <span className="sr-only">{recoveryKey}</span>
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
            void navigator.clipboard.writeText(recoveryKey).then(() => {
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
        <Button disabled={!saved} className="self-start" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}
