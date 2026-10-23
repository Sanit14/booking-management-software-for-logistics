/// <reference types="vite/client" />

// What electron/preload.ts exposes. The keeper bridge is added in session 1.2.
interface Window {
  bm: { version: string };
}
