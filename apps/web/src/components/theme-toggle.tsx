import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentTheme, setTheme } from '../theme/theme';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';

/** The sun/moon button. Its name says what a click will do. */
export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setThemeState] = useState(currentTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = t(next === 'dark' ? 'theme.toDark' : 'theme.toLight');

  return (
    <Tooltip label={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={() => {
          setTheme(next);
          setThemeState(next);
        }}
      >
        {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Button>
    </Tooltip>
  );
}
