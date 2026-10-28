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
