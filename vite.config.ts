import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron 22 = Chromium 108. Keep in step with electron/main.ts DEV_URL.
export default defineConfig({
  plugins: [
    react(),
    {
      // The dev-only HMR websocket has no place in the shipped page's CSP.
      name: 'production-csp',
      apply: 'build',
      transformIndexHtml: (html) => html.replace(' ws://127.0.0.1:5173', ''),
    },
  ],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'chrome108' },
});
