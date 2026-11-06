// Wrong-PIN counting. Pure, with an injected clock. Held in the keeper's memory, so a restarted keeper starts
// from zero (the card: "per keeper").
export type LockKind = 'admin' | 'system' | 'recovery';

export const MAX_TRIES = 5;
export const LOCK_MS = 60_000;

/** `lockMs` is for tests (BM_PIN_LOCK_MS), so a test that locks a PIN many times does not wait a minute each time. */
export function makeLockout(now: () => number = Date.now, lockMs = LOCK_MS) {
  const state = new Map<LockKind, { wrong: number; until: number }>();
  const of = (kind: LockKind) => {
    let s = state.get(kind);
    if (!s) state.set(kind, (s = { wrong: 0, until: 0 }));
    return s;
  };
  return {
    /** Whole seconds still to wait; 0 when the kind is open. A lock that has run out starts the count afresh. */
    lockedFor(kind: LockKind): number {
      const s = of(kind);
      if (s.until === 0) return 0;
      const left = s.until - now();
      if (left > 0) return Math.ceil(left / 1000);
      s.wrong = 0;
      s.until = 0;
      return 0;
    },
    fail(kind: LockKind): void {
      const s = of(kind);
      if (++s.wrong >= MAX_TRIES) s.until = now() + lockMs;
    },
    ok(kind: LockKind): void {
      state.delete(kind);
    },
  };
}
