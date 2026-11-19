/** The words for an answer that isn't about one field: too many tries, busy, or no connection. */
export function failureKey(code: string | undefined) {
  switch (code) {
    case 'too_many_attempts':
      return 'account.tooMany' as const;
    case 'busy':
      return 'login.busy' as const;
    default:
      return 'account.failed' as const;
  }
}
