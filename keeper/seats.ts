// Which seats have talked to the keeper lately. Every seat pings /health every 15 s with its name, so "seen in
// the last 45 s" means "has the app open". Pure, with an injected clock.
export const SEAT_FRESH_MS = 45_000;

export function makeSeats(now: () => number = Date.now) {
  const seen = new Map<string, { name: string; at: number }>();
  return {
    saw(name: string): void {
      seen.set(name.toLowerCase(), { name, at: now() });
    },
    /** Names of the other seats seen within SEAT_FRESH_MS. */
    othersOnline(own: string): string[] {
      const mine = own.toLowerCase();
      return [...seen].filter(([key, s]) => key !== mine && now() - s.at < SEAT_FRESH_MS).map(([, s]) => s.name);
    },
  };
}
