import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { messageFor, verifyPayload, SignatureError, type SignatureProblem } from './releaseSignature';

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey };
}
const release = { version: '0.1.1', sha512: 'c2hhNTEyLW9mLXRoZS1pbnN0YWxsZXI=' };
const sign = (r: { version: string; sha512: string }, privateKey: crypto.KeyObject) =>
  crypto.sign(null, Buffer.from(messageFor(r.version, r.sha512)), privateKey).toString('base64');

function problem(fn: () => void): SignatureProblem | 'none' {
  try {
    fn();
    return 'none';
  } catch (e) {
    assert.ok(e instanceof SignatureError, String(e));
    return e.problem;
  }
}

test('a release signed with the matching private key is accepted', () => {
  const k = keyPair();
  const doc = { ...release, signature: sign(release, k.privateKey) };
  assert.equal(problem(() => verifyPayload(release, doc, k.publicB64)), 'none');
});

test('a changed installer hash or version is refused, even with a once-valid signature', () => {
  const k = keyPair();
  const signature = sign(release, k.privateKey);
  const otherHash = { ...release, sha512: 'dGFtcGVyZWQ=' };
  const otherVersion = { ...release, version: '0.9.9' };
  // latest.yml says the tampered values, latest.sig still carries the honest ones
  assert.equal(problem(() => verifyPayload(otherHash, { ...release, signature }, k.publicB64)), 'mismatch');
  assert.equal(problem(() => verifyPayload(otherVersion, { ...release, signature }, k.publicB64)), 'mismatch');
  // an attacker rewrites latest.sig to match the tampered yml but cannot re-sign it
  assert.equal(problem(() => verifyPayload(otherHash, { ...otherHash, signature }, k.publicB64)), 'bad-signature');
});

test('a signature made with another key is refused', () => {
  const mine = keyPair();
  const theirs = keyPair();
  const doc = { ...release, signature: sign(release, theirs.privateKey) };
  assert.equal(problem(() => verifyPayload(release, doc, mine.publicB64)), 'bad-signature');
});

test('an empty public key refuses everything (a build that was never set up trusts nothing)', () => {
  const k = keyPair();
  const doc = { ...release, signature: sign(release, k.privateKey) };
  assert.equal(problem(() => verifyPayload(release, doc, '')), 'not-set-up');
});

test('a missing, empty or garbage signature file is refused', () => {
  const k = keyPair();
  assert.equal(problem(() => verifyPayload(release, null, k.publicB64)), 'mismatch');
  assert.equal(problem(() => verifyPayload(release, { ...release }, k.publicB64)), 'bad-signature'); // a document with no signature field
  assert.equal(problem(() => verifyPayload(release, { ...release, signature: '' }, k.publicB64)), 'bad-signature');
  assert.equal(problem(() => verifyPayload(release, { ...release, signature: '!!!not base64!!!' }, k.publicB64)), 'bad-signature');
  assert.equal(problem(() => verifyPayload(release, { ...release, signature: sign(release, k.privateKey) }, 'AAAA')), 'bad-signature');
});

test('a signature made for Delivery Manager is not valid here', () => {
  const k = keyPair();
  const dm = crypto.sign(null, Buffer.from(`deliverymanager-update-v1\n${release.version}\n${release.sha512}`), k.privateKey).toString('base64');
  assert.equal(problem(() => verifyPayload(release, { ...release, signature: dm }, k.publicB64)), 'bad-signature');
});
