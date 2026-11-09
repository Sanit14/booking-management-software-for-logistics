// What to do about the keeper, given what is on its port. Pure: the bridge does the probing and the spawning.
import type { Probe } from '../keeper/client';

/** The one liveness ping. Every open app checks /health this often; nothing else polls. */
export const KEEPER_PING_MS = 15000;

export type KeeperAction =
  | 'ok' // a usable keeper is there
  | 'wait' // one is starting, or busy: look again, do not start another
  | 'start' // nothing listens
  | 'replace' // an older build's keeper: shut it down first
  | 'wrong-app'; // something else owns the port

export function keeperAction(p: Probe, expectedVersion: number): KeeperAction {
  if (p.kind === 'foreign') return 'wrong-app';
  if (p.kind === 'down') return p.refused ? 'start' : 'wait';
  if (p.health.keeperVersion < expectedVersion) return 'replace';
  return p.health.state === 'starting' ? 'wait' : 'ok';
}

/** A seat that has seen the keeper it started exit with an error this many times in a row, within START_FAILS_WITHIN_MS, stops starting it. */
export const START_FAILS = 3;
export const START_FAILS_WITHIN_MS = 10 * 60 * 1000;

/**
 * Counts the starts of the keeper (by this seat) that ended in a non-zero exit. A migration that throws makes the keeper exit at every start, and
 * the 15 s ping would start it again for ever (a backup, a full check and a log line each time). After START_FAILS in the window the seat gives up,
 * and STAYS given up until a keeper is seen working (`ok()`) or the app is restarted: the screen says so, and nothing tries again by itself.
 * Pure, with an injected clock.
 */
export function makeStartGuard(now: () => number = Date.now) {
  let fails: number[] = [];
  let latched = false;
  return {
    failed(): void {
      fails = fails.filter((at) => now() - at < START_FAILS_WITHIN_MS);
      fails.push(now());
      if (fails.length >= START_FAILS) latched = true;
    },
    ok(): void {
      fails = [];
      latched = false;
    },
    gaveUp: (): boolean => latched,
  };
}
