import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { env: Record<string, string | undefined> };

// The production build is served by the Flask/WSGI app on PythonAnywhere, which
// maps /static/ and the SPA index, so assets use an absolute base of "/".
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    allowedHosts: process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
      ? [process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS]
      : [],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
