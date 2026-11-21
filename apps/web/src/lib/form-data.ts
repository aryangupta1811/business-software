/** A text field of a submitted form; a missing field or a file reads as empty. */
export function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}
