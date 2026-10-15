import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies all API + WebSocket traffic to the backend (port 8080),
// so the frontend never talks to Apex or computes anything itself.
export default defineConfig({
  plugins: [react()],
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
