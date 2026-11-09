// Which seats have talked to the keeper lately. Every seat pings /health every 15 s with its name, so "seen in
// the last 45 s" means "has the app open". Pure, with an injected clock.
export const SEAT_FRESH_MS = 45_000;
/** A seat not seen for this long is forgotten: any local program can send any name, and the list must not grow for ever. */
export const SEAT_FORGET_MS = 30 * 24 * 3600_000;

export function makeSeats(now: () => number = Date.now) {
  const seen = new Map<string, { name: string; at: number }>();
  return {
    saw(name: string): void {
      const t = now();
      for (const [key, s] of seen) if (t - s.at >= SEAT_FORGET_MS) seen.delete(key);
      seen.set(name.toLowerCase(), { name, at: t });
    },
    /** Names of the other seats seen within SEAT_FRESH_MS. */
    othersOnline(own: string): string[] {
      const mine = own.toLowerCase();
      return [...seen].filter(([key, s]) => key !== mine && now() - s.at < SEAT_FRESH_MS).map(([, s]) => s.name);
    },
    /** How many seats are remembered (for the test of the forgetting). */
    size: (): number => seen.size,
  };
}
