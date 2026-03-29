import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080',
      '/images': 'http://localhost:8080'
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
