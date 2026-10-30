/**
 * One log line for an error: its message and the messages of its causes, nothing else.
 * Never log the error object itself: pg-pool attaches the client to some errors, and
 * serializers that read hidden properties would print its password.
 */
export function describeError(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current !== undefined) {
    if (!(current instanceof Error)) {
      // A thrown object could hold anything, so only its kind is shown.
      messages.push(
        typeof current === 'string' ? current : `a thrown ${typeof current} (not an Error)`,
      );
      break;
    }
    // Drizzle appends the query's values after "params:"; they can be customers' data.
    const [message = ''] = current.message.split('\nparams:');
    messages.push(message.replace(/\s+/g, ' ').trim());
    current = current.cause;
  }
  return messages.join(' → ');
}
