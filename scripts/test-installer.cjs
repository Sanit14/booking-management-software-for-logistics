// Proves the installer's shared-folder step (build/installer.nsh, macro bmSharedFolder) with a REAL throw-away installer (session 4.4, audit O2):
//   - a normal folder is created and the Users group gets Modify on it (as before);
//   - a folder that is a link (a junction, or a directory symlink) is NOT touched. Measured on Windows 11: icacls sets the grant on a junction object
//     itself (the folder it points to is untouched), but it FOLLOWS a directory symlink and changes the target, children included. Both are skipped, since
//     the installer runs elevated and a folder in C:\ or ProgramData is one a Users account can delete and recreate.
// Everything happens under %TEMP%: the links are made there and the "system folders" they point to are folders made there too. Nothing outside it is read or changed.
// Needs makensis from the electron-builder cache (it exists once `npm run dist` has run), no administrator rights (the test installer runs as the current user).
// A directory symlink needs Developer Mode or an administrator; without it that case says "skipped" and only the junction case is proved.
//
//   node scripts/test-installer.cjs                       the macro in build/installer.nsh
//   node scripts/test-installer.cjs --nsh <file>          another version of it (the old one, to see the test fail)
//
// Not part of `npm run check` (it needs that cache and the Windows icacls tool). Exit code 0 = every case holds. The ACL check reads icacls' English
// group name ("Users"); on a Windows in another language adjust USERS below.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const USERS = /Users:\(OI\)\(CI\)\(M\)/;
const args = process.argv.slice(2);
const nsh = path.resolve(args.includes('--nsh') ? args[args.indexOf('--nsh') + 1] : path.join(__dirname, '..', 'build', 'installer.nsh'));

function findMakensis() {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache');
  const stack = [cache];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === 'makensis.exe' && path.basename(dir).startsWith('nsis-')) return p;
      if (e.isDirectory() && /^nsis-3/.test(e.name) || (e.isDirectory() && dir.includes('nsis-3'))) stack.push(p);
    }
  }
  return null;
}

const makensis = findMakensis();
if (!makensis) {
  console.error('makensis.exe not found in %LOCALAPPDATA%\\electron-builder\\Cache: run `npm run dist` once, then this again.');
  process.exit(2);
}
if (!fs.existsSync(nsh)) {
  console.error(`no such file: ${nsh}`);
  process.exit(2);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-installer-'));
const targetOfJunction = path.join(root, 'pretend-system-folder-1');
const targetOfSymlink = path.join(root, 'pretend-system-folder-2');
const junction = path.join(root, 'junction', 'BookingManagerData');
const symlink = path.join(root, 'symlink', 'BookingManagerData');
const normal = path.join(root, 'normal', 'BookingManagerData');
for (const d of [targetOfJunction, targetOfSymlink, path.dirname(junction), path.dirname(symlink)]) fs.mkdirSync(d);
fs.symlinkSync(targetOfJunction, junction, 'junction');
let symlinkMade = true;
try {
  fs.symlinkSync(targetOfSymlink, symlink, 'dir');
} catch (e) {
  symlinkMade = false;
  console.log(`(no directory symlink on this PC: ${e.code})`);
}

const installLog = path.join(process.env.TEMP || os.tmpdir(), 'BookingManager-install.log'); // where the macro keeps its SKIPPED lines
fs.rmSync(installLog, { force: true });
const script = path.join(root, 'test.nsi');
fs.writeFileSync(
  script,
  [
    'Unicode true',
    `OutFile "${path.join(root, 'test-installer.exe')}"`,
    'RequestExecutionLevel user',
    'SilentInstall silent',
    `!include "${nsh}"`,
    'Section',
    `  !insertmacro bmSharedFolder "${normal}"`,
    `  !insertmacro bmSharedFolder "${junction}"`,
    ...(symlinkMade ? [`  !insertmacro bmSharedFolder "${symlink}"`] : []),
    'SectionEnd',
    '',
  ].join('\r\n'),
);

const build = spawnSync(makensis, ['/V2', script], { encoding: 'utf8' });
if (build.status !== 0) {
  console.error(`${build.stdout}${build.stderr}`);
  process.exit(2);
}
const ran = spawnSync(path.join(root, 'test-installer.exe'), ['/S'], { encoding: 'utf8', timeout: 60000 });
const acl = (p) => spawnSync('icacls', [p], { encoding: 'utf8' }).stdout;

const TOP_LEVEL = ['C:\\BookingManagerData', '$BmProgramData\\BookingManager', 'D:\\BookingManagerBackups'];
const sharedByScript = [...fs.readFileSync(nsh, 'utf8').matchAll(/!insertmacro bmSharedFolder "([^"]+)"/g)].map((m) => m[1]);
const results = [
  ['a normal folder is created and the Users group can modify it', fs.existsSync(normal) && USERS.test(acl(normal))],
  ['a junction is skipped: the link itself gets no grant', !USERS.test(acl(junction))],
  ['a junction is skipped: the folder it points to gets no grant', !USERS.test(acl(targetOfJunction))],
  ...(symlinkMade ? [['a directory symlink is skipped: the folder it points to gets no grant (icacls would follow it)', !USERS.test(acl(targetOfSymlink))]] : []),
  ['each skip is written to %TEMP%\\BookingManager-install.log (an update installs silently)', fs.existsSync(installLog) && fs.readFileSync(installLog, 'latin1').includes(junction) && (!symlinkMade || fs.readFileSync(installLog, 'latin1').includes(symlink))],
  // The folders the install script itself shares: a folder BELOW another one would be created and granted through a link in place of its parent.
  ['the install script shares only top-level folders (nothing below another shared folder)', sharedByScript.length > 0 && sharedByScript.every((p) => TOP_LEVEL.includes(p))],
];
console.log(`installer: ${nsh}`);
for (const [what, pass] of results) console.log(`${pass ? 'ok    ' : 'FAILED'} ${what}`);
const allPass = results.every(([, pass]) => pass);
if (!allPass) console.log(`(test installer exit ${ran.status}; folders left in ${root})`);
else {
  // rmSync would follow nothing: it removes the links, not their targets, but remove the links first to be sure
  for (const l of [junction, symlink]) fs.rmSync(l, { recursive: false, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}
process.exit(allPass ? 0 : 1);
