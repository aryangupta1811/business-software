import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Kbd, KbdGroup } from '../components/ui/kbd';
import { keyLabels } from './keys';
import type { ShortcutGroup } from './registry';
import { useActiveShortcuts } from './use-shortcut';

const GROUPS: ShortcutGroup[] = ['general', 'navigation'];

/**
 * The list of shortcuts that work on this screen. A native <dialog>, not Radix Dialog:
 * Radix adds a <style> element at runtime, which the CSP's style-src 'self' blocks, while
 * the browser's dialog handles focus, Escape and the page behind by itself (ADR 0026).
 */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const shortcuts = useActiveShortcuts();
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
      className="m-auto w-full max-w-md rounded-lg bg-surface p-6 text-foreground shadow-card"
    >
      {open && (
        <>
          <h2 id={titleId} className="text-section font-semibold">
            {t('shortcuts.title')}
          </h2>
          {GROUPS.map((group) => {
            const inGroup = shortcuts.filter((shortcut) => shortcut.group === group);
            if (inGroup.length === 0) return null;
            const headingId = `${titleId}-${group}`;
            return (
              <section key={group} aria-labelledby={headingId} className="mt-5">
                <h3 id={headingId} className="text-label font-medium text-muted">
                  {t(`shortcuts.groups.${group}`)}
                </h3>
                <ul className="mt-2 divide-y divide-border">
                  {inGroup.map((shortcut) => (
                    <li key={shortcut.keys} className="flex items-center justify-between py-2">
                      <span>{t(shortcut.description)}</span>
                      <KbdGroup>
                        {keyLabels(shortcut.keys).map((label) => (
                          <Kbd key={label}>{label}</Kbd>
                        ))}
                      </KbdGroup>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              {t('shortcuts.close')}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
