import { useId, type ReactNode } from 'react';
import { Label } from './label';

export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/**
 * A label, its control and an optional error. The control gets the ids that tie them
 * together, so screen readers read the label and the error with it.
 */
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, ...(error && { 'aria-invalid': true, 'aria-describedby': errorId }) })}
      {error && (
        <p id={errorId} className="text-label text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
