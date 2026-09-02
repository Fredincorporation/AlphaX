import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            // Silently absorb transient disconnects / HMR refreshes without throwing noisy node stream errors
            if ((err as any).code === 'ECONNRESET' || (err as any).code === 'ECONNABORTED') return;
            console.warn('[vite ws proxy]', err.message);
          });
        },
      },
    },
  },
});