// The two PINs (Admin, System) and the recovery code. They live only here: stored as salted scrypt hashes in
// `settings`, checked only by the keeper, never logged or audited. The screen collects digits and passes them on.
// A 4-digit PIN has only 10,000 values, so the hash merely keeps the file from being read at a glance; the real
// protection is the lock after 5 wrong tries (lockout.ts).
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { KeeperResult, PinKind, ResultCode } from '../shared';
import { writeAudit } from './audit';
import type { Db } from './db';
import { makeLockout, type LockKind } from './lockout';

const PIN_RE = /^\d{4}$/;
// No 0/O/1/I: a code that is copied by hand from paper must not be ambiguous. 32 letters = 5 bits each.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const KEY: Record<LockKind, string> = { admin: 'pin_admin', system: 'pin_system', recovery: 'pin_recovery' };

const ok = <T>(value: T): KeeperResult<T> => ({ ok: true, value });
const refuse = (code: ResultCode, detail?: string): KeeperResult<never> => ({ ok: false, code, ...(detail ? { detail } : {}) });

function hash(secret: string): string {
  const salt = randomBytes(16);
  return `scrypt1$${salt.toString('hex')}$${scryptSync(secret, salt, 32).toString('hex')}`;
}

function matches(stored: string, secret: string): boolean {
  const [tag, salt, want] = stored.split('$');
  if (tag !== 'scrypt1' || !salt || !want) return false;
  const have = scryptSync(secret, Buffer.from(salt, 'hex'), 32);
  const expected = Buffer.from(want, 'hex');
  return have.length === expected.length && timingSafeEqual(have, expected);
}

const normaliseCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

function newRecoveryCode(): string {
  const chars = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return chars.replace(/(.{4})(?=.)/g, '$1-');
}

const read = (db: Db, kind: LockKind): string | undefined =>
  (db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY[kind]) as { value: string } | undefined)?.value;

const write = (db: Db, kind: LockKind, secret: string): void => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY[kind], hash(secret));
};

export function makePins(now: () => number = Date.now) {
  const lock = makeLockout(now);

  // Locked → refuse without looking at the secret. Wrong → count it; the fifth wrong try already says "locked".
  function check(db: Db, kind: LockKind, secret: string): KeeperResult<true> {
    const stored = read(db, kind);
    if (!stored) return refuse('pins-not-set');
    const wait = lock.lockedFor(kind);
    if (wait > 0) return refuse('pin-locked', String(wait));
    if (matches(stored, kind === 'recovery' ? normaliseCode(secret) : secret)) {
      lock.ok(kind);
      return ok(true);
    }
    lock.fail(kind);
    const after = lock.lockedFor(kind);
    return after > 0 ? refuse('pin-locked', String(after)) : refuse(kind === 'recovery' ? 'wrong-recovery-code' : 'wrong-pin');
  }

  const formatOf = (...pins: string[]): KeeperResult<never> | null => (pins.every((p) => PIN_RE.test(p)) ? null : refuse('bad-pin'));

  function audit(db: Db, seat: string, action: string): void {
    writeAudit(db, { seat, action: `pins.${action}`, entity: 'settings', entityId: 'pins' });
  }

  /** A new pair of PINs and a fresh recovery code, in the caller's transaction. */
  function storeAll(db: Db, admin: string, system: string): string {
    const code = newRecoveryCode();
    write(db, 'admin', admin);
    write(db, 'system', system);
    write(db, 'recovery', normaliseCode(code));
    return code;
  }

  return {
    isSet: (db: Db): boolean => read(db, 'admin') !== undefined,

    /** First run. Set once: if the PINs exist (another seat was first) nothing is changed. */
    setup(db: Db, seat: string, admin: string, system: string): KeeperResult<{ recoveryCode: string }> {
      const bad = formatOf(admin, system);
      if (bad) return bad;
      if (admin === system) return refuse('pins-same');
      return db.transaction((): KeeperResult<{ recoveryCode: string }> => {
        if (read(db, 'admin') !== undefined) return refuse('pins-already-set');
        const recoveryCode = storeAll(db, admin, system);
        audit(db, seat, 'setup');
        return ok({ recoveryCode });
      })();
    },

    verify: (db: Db, kind: PinKind, pin: string): KeeperResult<true> => check(db, kind, pin),

    changeSystem(db: Db, seat: string, adminPin: string, newPin: string): KeeperResult<true> {
      const bad = formatOf(newPin);
      if (bad) return bad;
      const gate = check(db, 'admin', adminPin);
      if (!gate.ok) return gate;
      if (newPin === adminPin) return refuse('pins-same');
      db.transaction(() => {
        write(db, 'system', newPin);
        audit(db, seat, 'change-system');
      })();
      return ok(true);
    },

    changeAdmin(db: Db, seat: string, adminPin: string, newPin: string): KeeperResult<true> {
      const bad = formatOf(newPin);
      if (bad) return bad;
      const gate = check(db, 'admin', adminPin);
      if (!gate.ok) return gate;
      if (matches(read(db, 'system') ?? '', newPin)) return refuse('pins-same');
      db.transaction(() => {
        write(db, 'admin', newPin);
        audit(db, seat, 'change-admin');
      })();
      return ok(true);
    },

    /** Forgot PINs: the recovery code opens both PINs for replacement and is itself replaced. */
    recover(db: Db, seat: string, recoveryCode: string, newAdmin: string, newSystem: string): KeeperResult<{ recoveryCode: string }> {
      const bad = formatOf(newAdmin, newSystem);
      if (bad) return bad;
      if (newAdmin === newSystem) return refuse('pins-same');
      const gate = check(db, 'recovery', recoveryCode);
      if (!gate.ok) return gate;
      const code = db.transaction(() => {
        const next = storeAll(db, newAdmin, newSystem);
        audit(db, seat, 'recover');
        return next;
      })();
      lock.ok('admin'); // the PINs it counted against are gone
      lock.ok('system');
      return ok({ recoveryCode: code });
    },
  };
}
