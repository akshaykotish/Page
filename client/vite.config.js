import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  server: {
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/images': 'http://127.0.0.1:8080'
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
