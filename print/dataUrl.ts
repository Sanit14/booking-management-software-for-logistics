/** Chromium refuses to load a URL longer than this (2 MiB of characters). */
export const MAX_DATA_URL_CHARS = 2 * 1024 * 1024;

/**
 * The `data:` URL that carries a printout into the hidden print window, or null when it is too long to load. The length is counted on the URL itself:
 * a character outside ASCII is 3 bytes in UTF-8 and 9 characters here (%E0%A4%85), so a row limit alone is no guarantee (1,000 rows of long Devanagari
 * names are over). The caller refuses such a printout and asks for a shorter one.
 */
export function printUrl(html: string): string | null {
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  return url.length <= MAX_DATA_URL_CHARS ? url : null;
}
