import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
    host: true,
    open: false,
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 4096,
  },
  // rapier3d-compat ships wasm inlined as base64, so no special plugin is needed,
  // but esbuild's prebundler chokes on the giant literal — serve it as-is.
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
