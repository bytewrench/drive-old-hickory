import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
    host: true,
    open: false,
    // The multiplayer relay is a separate process in dev (`npm run server`,
    // port 8080). Proxying it here means the client can always connect to
    // /ws on its own origin, dev and production alike.
    proxy: {
      '/ws': {
        target: process.env.MP_SERVER || 'ws://localhost:8080',
        ws: true,
        // Vite logs an unhandled ECONNREFUSED and dies noisily if the relay
        // isn't running; swallow it so single-player dev still works.
        configure: (proxy) => proxy.on('error', () => {}),
      },
    },
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
