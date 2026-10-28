// One-off: draws the sidebar logo (teal badge, orange lucide truck) as build/icon.png, 256x256.
// Run with Electron so no image library is needed:  npx electron scripts/make-icon.cjs
// The PNG is committed; electron-builder turns it into the .ico. Not shipped in the package.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, '..', 'build', 'icon.png');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="52" fill="#144d52"/>
  <g transform="translate(40 40) scale(7.0)" fill="none" stroke="#e66c32" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
    <path d="M15 18H9"/>
    <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
    <circle cx="17" cy="18" r="2"/>
    <circle cx="7" cy="18" r="2"/>
  </g>
</svg>`;

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 256, height: 256, useContentSize: true, frame: false, transparent: true });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = (await win.webContents.capturePage()).resize({ width: 256, height: 256 });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  console.log('wrote', out, image.getSize());
  app.quit();
});
