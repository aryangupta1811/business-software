import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface Choice {
  value: string;
  title: string;
  hint?: string;
  icon?: ReactNode;
}

/**
 * A group of options shown as cards. Each card is a native radio button or checkbox, so arrow
 * keys, Space and screen readers work as they do everywhere else; the input is hidden and the
 * card shows its state and focus.
 */
export function ChoiceCards({
  type = 'radio',
  label,
  choices,
  error,
  columns = 'grid-cols-2',
  inputProps,
}: {
  type?: 'radio' | 'checkbox';
  label: string;
  choices: Choice[];
  error?: string | undefined;
  /** A whole class name, so Tailwind can see it. */
  columns?: 'grid-cols-1' | 'grid-cols-2' | 'grid-cols-3';
  /** Spread onto every input (React Hook Form's `register`). */
  inputProps: ComponentProps<'input'>;
}) {
  const id = useId();
  return (
    <div
      role={type === 'radio' ? 'radiogroup' : 'group'}
      aria-labelledby={`${id}-label`}
      {...(error && { 'aria-describedby': `${id}-error`, 'aria-invalid': true })}
      className="flex flex-col gap-1.5"
    >
      <span id={`${id}-label`} className="text-label font-medium text-foreground">
        {label}
      </span>
      <div className={cn('grid gap-2', columns)}>
        {choices.map((choice) => (
          <label
            key={choice.value}
            className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border border-input-border bg-surface px-3 py-2.5 has-checked:border-primary has-checked:bg-surface-muted has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary"
          >
            <input
              type={type}
              value={choice.value}
              className="sr-only"
              {...inputProps}
              {...(choice.hint && { 'aria-describedby': `${id}-${choice.value}-hint` })}
            />
            {choice.icon && (
              <span aria-hidden="true" className="mt-0.5 text-accent [&_svg]:size-5">
                {choice.icon}
              </span>
            )}
            <span className="flex flex-col">
              <span className="text-body font-medium">{choice.title}</span>
              {choice.hint && (
                <span id={`${id}-${choice.value}-hint`} className="text-label text-muted">
                  {choice.hint}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-label text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
