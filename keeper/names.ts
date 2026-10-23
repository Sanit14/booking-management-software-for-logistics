// The unique key behind every master name (stations, firms, trucks): "Raj  Kumar " and "raj kumar" are one.
// NFC makes the same Devanagari or accented name typed with different combining sequences one key too.
export function nameKey(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}
