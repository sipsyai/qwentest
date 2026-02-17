import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Local and Tailscale fallback IPs for ubuntu-gpu
const LOCAL_IP = '192.168.1.8';
const TAILSCALE_IP = '100.96.50.76';

function proxyWithFallback(localTarget: string, fallbackTarget: string, rewriteFn: (p: string) => string) {
  return {
    target: localTarget,
    changeOrigin: true,
    rewrite: rewriteFn,
    configure: (proxy: any) => {
      proxy.on('error', (err: any, req: any, res: any) => {
        // On connection error, retry with Tailscale fallback
        const fallbackUrl = fallbackTarget + rewriteFn(req.url);
        console.warn(`[proxy] ${localTarget} failed, falling back to ${fallbackTarget}`);
        proxy.web(req, res, { target: fallbackTarget });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');

    const chatLocal = env.VITE_CHAT_URL || `http://${LOCAL_IP}:8010/v1`;
    const chatFallback = chatLocal.replace(LOCAL_IP, TAILSCALE_IP);
    const embedLocal = env.VITE_EMBED_URL || `http://${LOCAL_IP}:8011/v1`;
    const embedFallback = embedLocal.replace(LOCAL_IP, TAILSCALE_IP);

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api/chat': proxyWithFallback(
            chatLocal, chatFallback,
            (p) => p.replace(/^\/api\/chat/, ''),
          ),
          '/api/embed': proxyWithFallback(
            embedLocal, embedFallback,
            (p) => p.replace(/^\/api\/embed/, ''),
          ),
          '/api/kb': {
            target: 'http://localhost:8833',
            changeOrigin: true,
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
