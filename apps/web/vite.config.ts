/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Same-origin proxy so the refresh cookie (SameSite=Strict, path /api/v1/auth) just works.
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/socket.io': { target: API, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
