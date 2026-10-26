/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built twice for two different deploy targets that share this source: the standalone
// dashboard CloudFront distribution (root path, default base) and the unified landing+admin
// site where this app is served under /admin/ (VITE_BASE=/admin/ VITE_OUT_DIR=dist-admin).
// Without this, the built HTML's absolute asset paths (/assets/...) 404 once the app isn't
// actually at the site root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    outDir: process.env.VITE_OUT_DIR ?? 'dist',
  },
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
  },
});
