import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';

/**
 * Asks before an action, in the browser's own `<dialog>` (ADR 0026: never `window.confirm`,
 * and not Radix, whose injected style the CSP blocks). Esc or Cancel closes it.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirm,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-lg bg-surface p-6 text-foreground shadow-card"
    >
      {open && (
        <>
          <h2 id={titleId} className="text-section font-semibold">
            {title}
          </h2>
          <p id={bodyId} className="mt-2 text-muted">
            {body}
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('dialog.cancel')}
            </Button>
            <Button
              onClick={() => {
                onConfirm();
                onClose();
              }}
            >
              {confirm}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
