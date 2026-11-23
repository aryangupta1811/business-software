import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogActions } from '../components/ui/dialog';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { formText } from '../lib/form-data';

/**
 * Asked once for a day before today (`05` #8): why it is being changed. The page keeps the answer
 * for that day, so the next taps on it don't ask again.
 */
export function ReasonDialog({
  open,
  date,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  /** The day, written out for the person. */
  date: string;
  initial: string;
  onSave: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [missing, setMissing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setMissing(false);
  }
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = formText(new FormData(event.currentTarget), 'reason').trim();
    if (reason === '') {
      setMissing(true);
      return;
    }
    onSave(reason);
  };
  return (
    <Dialog open={open} title={t('attendance.reason.title')} onClose={onClose}>
      <form noValidate onSubmit={submit}>
        <p className="mb-4 text-muted">{t('attendance.reason.lead', { date })}</p>
        <Field
          label={t('attendance.reason.label')}
          error={missing ? t('errors.required') : undefined}
        >
          {(props) => (
            <Input
              {...props}
              name="reason"
              maxLength={200}
              autoComplete="off"
              defaultValue={initial}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the owner types the reason at once
              autoFocus
            />
          )}
        </Field>
        <DialogActions onClose={onClose} confirm={t('attendance.reason.save')} />
      </form>
    </Dialog>
  );
}
