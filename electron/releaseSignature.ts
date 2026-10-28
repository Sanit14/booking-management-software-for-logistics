// Checks that an update was signed with the private key kept on the release PC. Pure (no electron import) so
// `node --test` can run it. Why: the installer, latest.yml (with its SHA-512) and latest.sig sit in one public
// GitHub repo; whoever got into it could replace the installer and latest.yml with matching values, but only the
// private key can make latest.sig. The check fails closed: no key, no signature file, or a wrong one all refuse.
import crypto from 'node:crypto';

export interface Release {
  version: string;
  sha512: string;
}

/** latest.sig: the release's version and installer hash, and the Ed25519 signature over them (base64). */
export interface SignatureDoc {
  version?: unknown;
  sha512?: unknown;
  signature?: unknown;
}

export type SignatureProblem = 'not-set-up' | 'mismatch' | 'bad-signature';

/** Carries a code; the wording for the person is in src/strings.ts. */
export class SignatureError extends Error {
  constructor(readonly problem: SignatureProblem) {
    super(problem);
  }
}

// "bookingmanager": a signature made for another program with the same key could never be replayed here.
export const messageFor = (version: string, sha512: string): string => `bookingmanager-update-v1\n${version}\n${sha512}`;

/** publicKeyB64 = the Ed25519 public key, SPKI DER, base64 (electron/updatePublicKey.ts). Throws SignatureError. */
export function verifyPayload(release: Release, doc: SignatureDoc | null, publicKeyB64: string): void {
  if (!publicKeyB64) throw new SignatureError('not-set-up');
  if (!doc || doc.version !== release.version || doc.sha512 !== release.sha512) throw new SignatureError('mismatch');
  let good = false;
  try {
    if (typeof doc.signature !== 'string') throw new Error('no signature');
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    good = crypto.verify(null, Buffer.from(messageFor(release.version, release.sha512)), key, Buffer.from(doc.signature, 'base64'));
  } catch {
    good = false;
  }
  if (!good) throw new SignatureError('bad-signature');
}
