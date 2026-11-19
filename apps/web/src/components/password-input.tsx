import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { Button } from './ui/button';
import { Input } from './ui/input';

/** A password box with a show/hide button: on a shop counter, typos are easier to see than fix. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className={cn('pr-12', className)} />
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0"
        aria-label={t(shown ? 'password.hide' : 'password.show')}
        onClick={() => {
          setShown((was) => !was);
        }}
      >
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}
