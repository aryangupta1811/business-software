/** `%`, `_` and `\` typed in a search are letters, not LIKE wildcards: "contains this text". */
export const likeText = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
