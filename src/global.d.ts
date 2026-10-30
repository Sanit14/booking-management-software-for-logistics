/// <reference types="vite/client" />

// What electron/preload.ts exposes.
interface Window {
  bm: {
    version: string;
    keeper: import('../shared').KeeperApi;
    update: import('../shared').UpdateApi;
    keys: import('../shared').KeysApi;
  };
}
