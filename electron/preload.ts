import { contextBridge, ipcRenderer } from 'electron';
import type { KeeperApi } from '../shared';

// A sandboxed preload cannot call app.getVersion(); main passes it as an argument.
const PREFIX = '--app-version=';
const arg = process.argv.find((a) => a.startsWith(PREFIX));

// Named functions only: the screen can never name a keeper route.
const keeper: KeeperApi = { health: () => ipcRenderer.invoke('keeper:health') };

contextBridge.exposeInMainWorld('bm', { version: arg ? arg.slice(PREFIX.length) : 'unknown', keeper });
