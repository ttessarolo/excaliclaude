import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/canvas-app/frontend',
  plugins: [react()],
  build: {
    outDir: '../../../dist/frontend',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name?.startsWith('subset-')) {
            return 'assets/[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3100', changeOrigin: true },
      '/health': { target: 'http://localhost:3100', changeOrigin: true },
    },
  },
});
