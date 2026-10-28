// Release PC only:  npm run release
//   check -> dist -> sign the installer's checksum -> print the `gh release create` command.
// It never publishes: you run the printed command yourself. The version comes from package.json (change it first).
// Private key: BM_UPDATE_KEY=<path>, or  npm run release -- "<path>", or the default from `npm run update:keygen`.
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'release');
const keyFile = path.resolve(process.argv[2] || process.env.BM_UPDATE_KEY || path.join(os.homedir(), 'BookingManagerKeys', 'update-signing-private.pem'));
const RELEASES_REPO = 'Sanit14/BookingManager-releases';
const fail = (m) => {
  console.error(m);
  process.exit(1);
};

if (!fs.existsSync(keyFile)) fail(`Private key not found:\n  ${keyFile}\nRun \`npm run update:keygen\` once on this PC, or pass the key path.`);
for (const step of ['check', 'dist']) {
  console.log(`\n> npm run ${step}`);
  if (spawnSync('npm', ['run', step], { cwd: root, stdio: 'inherit', shell: true }).status !== 0) fail(`npm run ${step} failed; nothing was signed.`);
}

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const yml = fs.readFileSync(path.join(outDir, 'latest.yml'), 'utf8');
// electron-builder writes the top-level `path` and `sha512` of the installer; the indented copies belong to `files:`.
// (Spaces and tabs are spelt out: a backslash-s inside a template literal would silently become a plain "s".)
const top = (key) => (new RegExp(`^${key}:[ \t]*(.+?)[ \t]*$`, 'm').exec(yml) || [])[1];
const ymlVersion = top('version');
const installer = top('path');
const sha512 = top('sha512');
if (ymlVersion !== version || !installer || !sha512) fail('release/latest.yml does not match package.json. Run again.');
const installerPath = path.join(outDir, installer);
if (!fs.existsSync(installerPath)) fail(`Installer not found next to latest.yml: ${installer}`);
const actual = crypto.createHash('sha512').update(fs.readFileSync(installerPath)).digest('base64');
if (actual !== sha512) fail('The installer does not match the hash in latest.yml. Run again.');

// The same code the app runs, compiled by `dist`.
const { messageFor, verifyPayload } = require(path.join(root, 'dist-electron', 'electron', 'releaseSignature.js'));
const { UPDATE_PUBLIC_KEY } = require(path.join(root, 'dist-electron', 'electron', 'updatePublicKey.js'));
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile));
const doc = { version, sha512, signature: crypto.sign(null, Buffer.from(messageFor(version, sha512)), privateKey).toString('base64') };
// Prove the app built from this folder would accept it: its baked-in public key must belong to this private key.
try {
  verifyPayload({ version, sha512 }, doc, UPDATE_PUBLIC_KEY);
} catch (e) {
  fail(`Signed, but the app in this folder would REJECT the signature (${e.problem || e.message}).\nThe public key in electron/updatePublicKey.ts does not belong to this private key. Fix the key, run again.`);
}
fs.writeFileSync(path.join(outDir, 'latest.sig'), JSON.stringify(doc, null, 2) + '\n');

const files = [installer, `${installer}.blockmap`, 'latest.yml', 'latest.sig'];
for (const f of files) if (!fs.existsSync(path.join(outDir, f))) fail(`Missing release file: ${f}`);
console.log(`\nSigned version ${version}. To publish it (this is the step that makes it visible to the clerks' apps), run in PowerShell:\n`);
console.log(`gh release create v${version} --repo ${RELEASES_REPO} --title "Booking Manager ${version}" --notes "Booking Manager ${version}" ${files.map((f) => `"${path.join('release', f)}"`).join(' ')}`);
