import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev client proxies API + WebSocket calls to the Node server (port 8787).
export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  publicDir: false,
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
