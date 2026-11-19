import { useTranslation } from 'react-i18next';
import type { ApiError } from '../api/client';

/** "Try again at 14:35": the time a `too_many_attempts` answer allows the next try (#41). */
export function useRetryTime(): (error: ApiError) => string {
  const { i18n } = useTranslation();
  return (error) =>
    new Date(error.retryAt ?? Date.now()).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
    });
}
