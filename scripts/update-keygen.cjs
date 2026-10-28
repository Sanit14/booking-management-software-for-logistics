// Once, on the RELEASE PC:  npm run update:keygen
//   - the PRIVATE key goes to a file OUTSIDE the project (%USERPROFILE%\BookingManagerKeys\ by default): never commit
//     it, never copy it to a client PC, back it up (losing it means the next update must be installed by hand)
//   - the PUBLIC key is written into electron/updatePublicKey.ts, so every build from now on trusts it
// Optional:  npm run update:keygen -- "D:\Keys\update-signing-private.pem"
// It refuses to overwrite an existing private key: installed apps would then refuse your updates.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const keyFile = path.resolve(process.argv[2] || path.join(os.homedir(), 'BookingManagerKeys', 'update-signing-private.pem'));
const publicFile = path.join(__dirname, '..', 'electron', 'updatePublicKey.ts');

if (fs.existsSync(keyFile)) {
  console.error(`A private key already exists at:\n  ${keyFile}\nNot overwriting it. Delete it yourself only if you really want a new key.`);
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(keyFile), { recursive: true });
fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
fs.writeFileSync(
  publicFile,
  `// Public half of the update-signing key (Ed25519, SPKI DER, base64). Safe to publish.\n// Written by \`npm run update:keygen\`. While this is empty the app refuses every update (releaseSignature.ts).\nexport const UPDATE_PUBLIC_KEY = '${pub}';\n`,
);
console.log(`Private key written to:\n  ${keyFile}\n  -> BACK THIS FILE UP. Keep it off GitHub and off the client PCs.\nPublic key written into electron/updatePublicKey.ts.\nNow rebuild the app (npm run dist): only builds made from here on trust updates signed with this key.`);
