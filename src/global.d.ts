/// <reference types="vite/client" />

// What electron/preload.ts exposes.
interface Window {
  bm: {
    version: string;
    packaged: boolean;
    keeper: import('../shared').KeeperApi;
    update: import('../shared').UpdateApi;
    keys: import('../shared').KeysApi;
    print: import('../shared').PrintApi;
  };
}
