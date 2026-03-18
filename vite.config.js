import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': process.env.ORB_SERVER_URL || 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
  },
});
