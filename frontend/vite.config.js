import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies all API + WebSocket traffic to the backend (port 8080),
// so the frontend never talks to Apex or computes anything itself.
export default defineConfig({
  plugins: [react()],
  // Build stamp: shown in the in-app diagnostics so we can tell which build is
  // actually running on a device (PWA vs an old native IPA).
  define: {
    __INLAP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16) + 'Z'),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
