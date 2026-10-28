import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { initKeeperBridge } from './keeperBridge';

const DEV_URL = 'http://127.0.0.1:5173'; // same host and port as vite.config.ts
const dev = process.argv.includes('--dev'); // `npm run dev` passes it; without it the built dist/ is loaded

app.setAppUserModelId('com.sundeepfreight.bookingmanager');

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 1024,
    minHeight: 768,
    show: false, // shown maximised once the page is ready, so there is no flash of a small window
    title: 'Booking Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--app-version=${app.getVersion()}`],
    },
  });

  // No remote content: the only pages this window may show are our own.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const { origin, protocol } = new URL(url);
    if (dev ? origin !== DEV_URL : protocol !== 'file:') event.preventDefault();
  });

  if (dev) {
    // `npm run dev -- --components` opens the Components page directly (the screen reads the hash).
    void win.loadURL(process.argv.includes('--components') ? `${DEV_URL}#components` : DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }
  win.once('ready-to-show', () => {
    win.maximize(); // clerks switch to DM and other programs, so maximised rather than kiosk
    win.show();
  });
  win.webContents.once('did-fail-load', () => win.show()); // never leave a hidden window holding the single-instance lock
  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

// Electron 22 has no lock name: the lock is keyed on the userData folder (%APPDATA%\Booking Manager,
// from productName), so it is per Windows user and cannot collide with DM.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // no File/Edit/View bar; the app has its own navigation
    initKeeperBridge(app.getPath('userData'));
    mainWindow = createWindow();
  });
}
