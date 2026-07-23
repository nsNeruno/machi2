import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '');
  const sharedSource = fileURLToPath(
    new URL('../../packages/shared/src/index.ts', import.meta.url),
  );

  return {
    envDir: workspaceRoot,
    plugins: [
      react(),
      VitePWA({
        injectRegister: 'inline',
        registerType: 'prompt',
        includeAssets: ['icons/machi2.svg', 'icons/machi2-maskable.svg'],
        manifest: {
          name: 'Machi2',
          short_name: 'Machi2',
          description: 'Live arcade cabinet queues.',
          theme_color: '#163a40',
          background_color: '#e6ece8',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/icons/machi2.svg',
              sizes: 'any',
              type: 'image/svg+xml',
            },
            {
              src: '/icons/machi2-maskable.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{css,html,js,png,svg}'],
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [],
        },
      }),
    ],
    resolve: {
      // The package emits CommonJS for Nest. Point Vite at the ESM source in dev and builds.
      alias: {
        '@machi2/shared': sharedSource,
      },
    },
    server: {
      // Bind all interfaces so other devices on the same Wi-Fi can reach the dev
      // server (open http://<your-LAN-IP>:5173 on the phone). `/api` is proxied
      // server-side to the local API, so it's still single-origin — no CORS, and
      // the API doesn't need to be exposed directly. Set VITE_HOST=localhost to
      // keep it loopback-only.
      host: env.VITE_HOST || true,
      port: Number(env.VITE_PORT || 5173),
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'node',
    },
  };
});
