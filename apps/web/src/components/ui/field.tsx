import { useId, type ReactNode } from 'react';
import { Label } from './label';

export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/**
 * A label, its control, an optional error and an optional hint. The control gets the ids that
 * tie them together, so screen readers read the label, then the error, then the hint.
 */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        ...(error && { 'aria-invalid': true }),
        ...(describedBy && { 'aria-describedby': describedBy }),
      })}
      {error && (
        <p id={errorId} className="text-label text-danger">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-label text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
