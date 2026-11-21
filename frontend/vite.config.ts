import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In development the site runs on http://localhost:5173 and every /api call is proxied to
// the Citizen Concierge (FastAPI), so the session cookie stays same-origin.
// `npm run build` writes frontend/dist, which the Concierge serves on http://127.0.0.1:8000.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backend = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': { target: backend, changeOrigin: true } },
    },
    preview: { port: 4173, proxy: { '/api': { target: backend, changeOrigin: true } } },
    build: { outDir: 'dist', assetsDir: 'assets', sourcemap: true },
  };
});
