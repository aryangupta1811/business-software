import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';

/**
 * A native `<dialog>` for forms (ADR 0026): shown with `showModal()` while `open`, and Esc or
 * Cancel calls `onClose`. Its content exists only while it is open, so a form inside starts
 * empty every time. While it's open the page's shortcuts are off.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
      onClose={onClose}
      className={`m-auto w-full ${wide ? 'max-w-xl' : 'max-w-md'} rounded-lg bg-surface p-6 text-foreground shadow-card`}
    >
      {open && (
        <>
          <h2 id={titleId} className="text-section font-semibold">
            {title}
          </h2>
          <div className="mt-4">{children}</div>
        </>
      )}
    </dialog>
  );
}

/** Cancel, then the dialog's one action, which submits the form around it. */
export function DialogActions({
  onClose,
  confirm,
  busy = false,
  danger = false,
}: {
  onClose: () => void;
  confirm: string;
  busy?: boolean;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-6 flex justify-end gap-3">
      <Button variant="secondary" onClick={onClose}>
        {t('dialog.cancel')}
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>
        {confirm}
      </Button>
    </div>
  );
}
