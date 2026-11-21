import type { StaffView } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { STAFF_KEY } from '../api/staff';

export type StaffAction = 'reset' | 'deactivate' | 'reactivate';

/**
 * Which dialog on a staff login is open (P1.5 design §6), and the words to show once an action
 * worked. One host for the list and the edit page; `<StaffDialogs>` draws the dialogs.
 */
export function useStaffDialogs() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<{ kind: StaffAction; person: StaffView } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return {
    open,
    notice,
    ask: (kind: StaffAction, person: StaffView) => {
      setNotice(null);
      setOpen({ kind, person });
    },
    close: () => {
      setOpen(null);
    },
    /** An action worked: say so, close the dialog and re-read the list. */
    done: (message: string) => {
      setNotice(message);
      setOpen(null);
      void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
    },
  };
}

export type StaffDialogsHost = ReturnType<typeof useStaffDialogs>;
