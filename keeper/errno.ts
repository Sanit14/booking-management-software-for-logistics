/**
 * The OS error code of an error or of its message text (`EACCES: permission denied, open 'D:\...'` -> `EACCES`), or undefined. Only this code leaves
 * the keeper for a screen: the rest of the text names paths and files, and goes to the log. The screen turns the code into words (src/strings.ts).
 */
export function errnoOf(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^E[A-Z0-9]+$/.test(code)) return code;
  const text = typeof e === 'string' ? e : String((e as { message?: unknown } | null)?.message ?? '');
  return /^(E[A-Z0-9]+)\b/.exec(text)?.[1];
}
