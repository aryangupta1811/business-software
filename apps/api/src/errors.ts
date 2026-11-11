// Drizzle appends the query's values after "params:"; they can be customers' data.
function ownMessage(error: Error): string {
  const [message = ''] = error.message.split('\nparams:');
  return message.replace(/\s+/g, ' ').trim();
}

// An AggregateError's own message can be empty: Node throws one when every address of a host
// refuses the connection (`localhost` is both ::1 and 127.0.0.1). The reasons are inside it.
function innerMessages(error: Error): string {
  const inner: unknown[] = error instanceof AggregateError ? error.errors : [];
  return inner
    .map((item) => (item instanceof Error ? ownMessage(item) : ''))
    .filter((message) => message !== '')
    .join('; ');
}

/**
 * One log line for an error: its message and the messages of its causes, nothing else.
 * Never log the error object itself: pg-pool attaches the client to some errors, and
 * serializers that read hidden properties would print its password.
 */
export function describeError(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  // `seen` ends a chain of causes that loops back on itself.
  while (!seen.has(current)) {
    if (!(current instanceof Error)) {
      // A thrown object could hold anything, so only its kind is shown.
      messages.push(
        typeof current === 'string' ? current : `a thrown ${typeof current} (not an Error)`,
      );
      break;
    }
    seen.add(current);
    messages.push(ownMessage(current) || innerMessages(current) || current.name);
    if (current.cause === undefined || current.cause === null) break;
    current = current.cause;
  }
  return messages.join(' → ');
}
