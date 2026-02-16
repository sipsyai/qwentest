import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api/chat': {
            target: env.VITE_CHAT_URL || 'http://192.168.1.8:8010/v1',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/chat/, ''),
          },
          '/api/embed': {
            target: env.VITE_EMBED_URL || 'http://192.168.1.8:8011/v1',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/embed/, ''),
          },
          '/api/strapi': {
            target: 'https://strapi.sipsy.ai/api',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/strapi/, ''),
          },
        },
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
